import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "vitest";
import { db } from "../api/src/db.js";
import {
  api,
  cleanupBackend,
  closeBackend,
  resetBackend,
  setTargetStatus,
  startBackend,
  targetHits,
  targetUrl,
  waitForChecks,
} from "./helpers.js";

async function makeDue(monitorId: string) {
  // Correctness tests only; benchmark tests leave real schedules untouched.
  await db`UPDATE monitors SET next_run_at = now() - interval '1 second' WHERE id = ${monitorId}`;
}

beforeAll(startBackend);
beforeEach(() => resetBackend());
afterEach(cleanupBackend);
afterAll(closeBackend);

test("creates, checks, pauses, resumes, and deletes a monitor", async () => {
  const created = await api("/api/monitors", "POST", {
    name: "E2E service",
    url: targetUrl,
  });
  expect(created.status).toBe(201);
  const id = created.body.id;
  await waitForChecks(id, 1);

  const monitor = await api(`/api/monitors/${id}`);
  expect(monitor.body).toMatchObject({ status: "up", consecutiveFailures: 0 });
  const checks = await api(`/api/monitors/${id}/checks`);
  expect(checks.body[0]).toMatchObject({ ok: true, statusCode: 200 });
  const [saved] =
    await db`SELECT lease_until, next_run_at > now() AS scheduled FROM monitors WHERE id = ${id}`;
  expect(saved).toMatchObject({ lease_until: null, scheduled: true });

  const paused = await api(`/api/monitors/${id}/pause`, "POST");
  expect(paused.status).toBe(200);
  expect(paused.body.paused).toBe(true);
  await makeDue(id);
  const hitsBefore = targetHits;
  // Observe a complete five-second poll while the paused monitor is due.
  await delay(5500);
  expect(targetHits).toBe(hitsBefore);
  expect((await api(`/api/monitors/${id}/checks`)).body).toHaveLength(1);

  const resumed = await api(`/api/monitors/${id}/resume`, "POST");
  expect(resumed.status).toBe(200);
  expect(resumed.body.paused).toBe(false);
  await waitForChecks(id, 2);

  expect((await api(`/api/monitors/${id}`, "DELETE")).status).toBe(204);
  expect((await api(`/api/monitors/${id}`)).status).toBe(404);
  const [remaining] =
    await db`SELECT count(*)::int AS count FROM check_runs WHERE monitor_id = ${id}`;
  expect(remaining.count).toBe(0);
});

test("opens one incident after failures and resolves it on recovery", async () => {
  setTargetStatus(503);
  const created = await api("/api/monitors", "POST", {
    name: "E2E failing service",
    url: targetUrl,
  });
  expect(created.status).toBe(201);
  const id = created.body.id;

  for (let count = 1; count <= 3; count++) {
    await makeDue(id);
    await waitForChecks(id, count);
  }
  const down = await api(`/api/monitors/${id}`);
  expect(down.body).toMatchObject({ status: "down", consecutiveFailures: 3 });
  const incidents = await api(`/api/monitors/${id}/incidents`);
  expect(incidents.status).toBe(200);
  expect(incidents.body).toHaveLength(1);
  expect(incidents.body[0].resolvedAt).toBeNull();

  setTargetStatus(200);
  await makeDue(id);
  await waitForChecks(id, 4);
  const recovered = await api(`/api/monitors/${id}`);
  expect(recovered.body).toMatchObject({
    status: "up",
    consecutiveFailures: 0,
  });
  const resolved = await api(`/api/monitors/${id}/incidents`);
  expect(resolved.body).toHaveLength(1);
  expect(resolved.body[0].id).toBe(incidents.body[0].id);
  expect(resolved.body[0].resolvedAt).not.toBeNull();
});
