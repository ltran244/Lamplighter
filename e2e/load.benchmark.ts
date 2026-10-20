import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { db } from "../api/src/db.js";
import { detectionTimeoutSeconds, workload } from "./benchmark-settings.js";
import {
  api,
  assertWorkerRunning,
  cleanupBackend,
  closeBackend,
  resetBackend,
  setTargetStatus,
  startBackend,
  startWorker,
  stopWorker,
  targetUrl,
  waitForChecks,
} from "./helpers.js";

beforeAll(startBackend);
afterEach(cleanupBackend);
afterAll(closeBackend);

async function databaseTime(): Promise<Date> {
  const [row] = await db`SELECT clock_timestamp() AS time`;
  return row.time;
}

async function observe(seconds: number, phase: string) {
  console.log(`${phase}: observing ${seconds} seconds of real scheduling`);
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await delay(Math.min(30_000, Math.max(0, end - performance.now())));
    assertWorkerRunning();
    console.log(
      `${phase}: ${Math.max(0, Math.ceil((end - performance.now()) / 1000))} seconds remaining`,
    );
  }
}

test("collects throughput, scheduling delay, and isolated outage detection", async () => {
  const userId = await resetBackend(false);
  const monitorIds: string[] = [];
  for (let index = 0; index < workload.monitors; index++) {
    const response = await api("/api/monitors", "POST", {
      name: `Benchmark ${index + 1}`,
      url: targetUrl,
      intervalSeconds: workload.intervalSeconds,
    });
    expect(response.status).toBe(201);
    monitorIds.push(response.body.id);
  }

  await startWorker();
  await observe(workload.warmupSeconds, "Warm-up");
  const startedAt = await databaseTime();
  await observe(workload.seconds, "Measurement");
  const endedAt = await databaseTime();
  // Finish the measurement before reading results; no further writes can race it.
  await stopWorker();
  const measuredSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  const [metrics] = await db<
    {
      completedChecks: number;
      monitorsChecked: number;
      p50DelayMs: number | null;
      p99DelayMs: number | null;
      averageHttpLatencyMs: number | null;
    }[]
  >`
    SELECT count(*)::int AS "completedChecks",
      count(DISTINCT c.monitor_id)::int AS "monitorsChecked",
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.actual_start - c.scheduled_at)) * 1000
      ) AS "p50DelayMs",
      percentile_cont(0.99) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.actual_start - c.scheduled_at)) * 1000
      ) AS "p99DelayMs",
      avg(c.latency_ms)::double precision AS "averageHttpLatencyMs"
    FROM check_runs c JOIN monitors m ON m.id = c.monitor_id
    WHERE m.user_id = ${userId}
      AND c.finished_at >= ${startedAt} AND c.finished_at < ${endedAt}
  `;
  const checks = await db`
    SELECT c.id, c.monitor_id, c.scheduled_at, c.actual_start, c.finished_at,
      c.status_code, c.latency_ms, c.ok, c.worker_id,
      (extract(epoch FROM (c.actual_start - c.scheduled_at)) * 1000)::double precision AS scheduling_delay_ms
    FROM check_runs c JOIN monitors m ON m.id = c.monitor_id
    WHERE m.user_id = ${userId}
      AND c.finished_at >= ${startedAt} AND c.finished_at < ${endedAt}
    ORDER BY c.finished_at, c.id
  `;
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const report = {
    label: workload.label,
    generatedAt: new Date().toISOString(),
    workload: {
      ...workload,
      requestedChecksPerMinute:
        (workload.monitors * 60) / workload.intervalSeconds,
      target: "local HTTP 200, immediate response",
      startPattern: "all monitors initially due; normal scheduling thereafter",
    },
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
      go: execFileSync("go", ["version"], { encoding: "utf8" }).trim(),
      gitRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
      workingTreeDirty:
        execFileSync("git", ["status", "--porcelain"], {
          cwd: repo,
          encoding: "utf8",
        }).trim().length > 0,
    },
    measurement: {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      measuredSeconds,
      ...metrics,
      checksPerMinute: metrics.completedChecks / (measuredSeconds / 60),
      sampleDefinition:
        "persisted checks finished within [startedAt, endedAt); warm-up and outage phase excluded",
    },
    detection: {
      status: "pending",
      scope:
        "one healthy monitor, workload monitors paused, one worker; HTTP detection only",
      intervalSeconds: workload.intervalSeconds,
      failureThreshold: 3,
      timeoutSeconds: detectionTimeoutSeconds,
      outageStartedAt: null as string | null,
      incidentStartedAt: null as string | null,
      detectionMs: null as number | null,
    },
  };
  const directory = fileURLToPath(new URL("./results/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const label = workload.label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const filename = `${report.generatedAt.replace(/[:.]/g, "-")}-${label}-${workload.monitors}monitors`;
  const jsonPath = join(directory, `${filename}.json`);
  const csvPath = join(directory, `${filename}.csv`);
  const columns = [
    "id",
    "monitor_id",
    "scheduled_at",
    "actual_start",
    "finished_at",
    "status_code",
    "latency_ms",
    "ok",
    "worker_id",
    "scheduling_delay_ms",
  ];
  const cell = (value: unknown) =>
    `"${String(value instanceof Date ? value.toISOString() : (value ?? "")).replaceAll('"', '""')}"`;
  await writeFile(
    csvPath,
    [
      columns.join(","),
      ...checks.map((row) =>
        columns.map((column) => cell(row[column])).join(","),
      ),
    ].join("\n") + "\n",
  );
  const saveReport = () =>
    writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n");
  // Preserve the throughput data even if outage detection later fails or times out.
  await saveReport();
  console.log(
    `Throughput: ${report.measurement.checksPerMinute.toFixed(2)} checks/min from ${metrics.completedChecks} samples`,
  );
  console.log(
    `Scheduling delay: p50=${metrics.p50DelayMs}ms, p99=${metrics.p99DelayMs}ms`,
  );
  console.log(`Reports: ${jsonPath}\n${csvPath}`);

  try {
    expect(
      metrics.completedChecks,
      "No samples; increase BENCH_SECONDS to cover at least one monitor interval.",
    ).toBeGreaterThan(0);
    for (const id of monitorIds) {
      expect((await api(`/api/monitors/${id}/pause`, "POST")).status).toBe(200);
    }
    const probe = await api("/api/monitors", "POST", {
      name: "Outage detection probe",
      url: targetUrl,
      intervalSeconds: workload.intervalSeconds,
    });
    expect(probe.status).toBe(201);
    await startWorker();
    await waitForChecks(probe.body.id, 1);
    const outageAt = await databaseTime();
    report.detection.outageStartedAt = outageAt.toISOString();
    setTargetStatus(503);
    await saveReport();
    console.log(
      `Outage phase: waiting for three naturally scheduled failures (timeout ${detectionTimeoutSeconds}s)`,
    );
    const deadline = performance.now() + detectionTimeoutSeconds * 1000;
    let lastProgress = performance.now();
    while (performance.now() < deadline) {
      assertWorkerRunning();
      const [incident] = await db`
        SELECT started_at FROM incidents WHERE monitor_id = ${probe.body.id}
      `;
      if (incident) {
        report.detection.status = "detected";
        report.detection.incidentStartedAt = incident.started_at.toISOString();
        report.detection.detectionMs =
          incident.started_at.getTime() - outageAt.getTime();
        console.log(
          `Isolated outage detection: ${report.detection.detectionMs}ms`,
        );
        return;
      }
      if (performance.now() - lastProgress >= 30_000) {
        console.log(
          `Outage phase: ${Math.ceil((deadline - performance.now()) / 1000)} seconds remaining`,
        );
        lastProgress = performance.now();
      }
      await delay(500);
    }
    report.detection.status = "timed_out";
    throw new Error(
      `No incident within ${detectionTimeoutSeconds}s; throughput results saved to ${jsonPath}`,
    );
  } catch (error) {
    if (report.detection.status === "pending")
      report.detection.status = "failed";
    throw error;
  } finally {
    await saveReport();
  }
});
