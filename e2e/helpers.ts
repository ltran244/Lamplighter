import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import { buildApp } from "../api/src/app.js";
import { db } from "../api/src/db.js";
import { SESSION_COOKIE } from "../api/src/session.js";
import { createUserSession } from "../api/test/helpers.js";

const app = buildApp();
app.log.level = "silent";

let targetStatus = 200;
export let targetHits = 0;
const target = createServer((_req, reply) => {
  targetHits++;
  reply.writeHead(targetStatus).end();
});

let apiUrl: string;
export let targetUrl: string;
let cookie: string;
let worker: ChildProcess | undefined;
let workerOutput = "";
let databaseReady = false;

export async function startWorker() {
  workerOutput = "";
  let startupError: Error | undefined;
  worker = spawn(
    fileURLToPath(new URL("../worker/bin/worker-e2e", import.meta.url)),
    [],
    {
      env: { ...process.env, EMAIL: "", EMAIL_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  worker.on("error", (err) => {
    startupError = err;
  });
  const collect = (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-8000);
  };
  worker.stdout!.on("data", collect);
  worker.stderr!.on("data", collect);

  await vi.waitFor(
    () => {
      expect(startupError).toBeUndefined();
      expect(worker!.exitCode, workerOutput).toBeNull();
      expect(workerOutput).toContain("connected to PostgreSQL");
    },
    { timeout: 5000, interval: 50 },
  );
}

export async function stopWorker() {
  const child = worker;
  worker = undefined;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const forceStop = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(forceStop);
  }
}

export function assertWorkerRunning() {
  expect(worker?.exitCode, workerOutput).toBeNull();
  expect(worker?.signalCode, workerOutput).toBeNull();
}

export async function api(path: string, method = "GET", payload?: unknown) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

export async function waitForChecks(monitorId: string, count: number) {
  await vi.waitFor(
    async () => {
      assertWorkerRunning();
      const response = await api(`/api/monitors/${monitorId}/checks`);
      expect(response.status).toBe(200);
      expect(response.body, workerOutput).toHaveLength(count);
    },
    { timeout: 15_000, interval: 200 },
  );
}

export function setTargetStatus(status: number) {
  targetStatus = status;
}

export async function startBackend() {
  const testDatabase = process.env.POSTGRES_TEST_DB ?? "lamplighter_test";
  const [connection] = await db`SELECT current_database() AS name`;
  if (process.env.NODE_ENV !== "test" || connection.name !== testDatabase) {
    throw new Error("Backend E2E tests must use POSTGRES_TEST_DB.");
  }
  databaseReady = true;
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
  apiUrl = await app.listen({ port: 0, host: "127.0.0.1" });
}

export async function resetBackend(runWorker = true) {
  if (!databaseReady) throw new Error("Test database has not been verified.");
  await db`DELETE FROM users`;
  targetStatus = 200;
  targetHits = 0;
  const session = await createUserSession();
  cookie = `${SESSION_COOKIE}=${session.cookies[SESSION_COOKIE]}`;
  if (runWorker) await startWorker();
  return session.userId;
}

export async function cleanupBackend() {
  await stopWorker();
  if (databaseReady) await db`DELETE FROM users`;
}

export async function closeBackend() {
  await stopWorker();
  try {
    if (target.listening) {
      const closed = once(target, "close");
      target.close();
      await closed;
    }
  } finally {
    await app.close();
  }
}
