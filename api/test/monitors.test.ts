import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import type { CreateMonitorInput } from "../src/queries/monitors.js";
import { createUserSession } from "./helpers.js";

const app = buildApp();

beforeEach(async () => {
  await db`DELETE FROM users`;
});

afterAll(async () => {
  try {
    await db`DELETE FROM users`;
  } finally {
    await app.close();
  }
});

async function createTestMonitor(
  cookies: Record<string, string>,
  overrides: Partial<CreateMonitorInput> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/monitors",
    cookies,
    payload: {
      name: "Test service",
      url: "https://example.com/health",
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

async function createTestChecks(monitorId: string) {
  return db<{ id: string; scheduled_at: Date }[]>`
    INSERT INTO check_runs
      (monitor_id, scheduled_at, actual_start, finished_at, status_code, latency_ms, ok, worker_id)
    VALUES
      (${monitorId}, now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', 503, 200, false, 'test-worker'),
      (${monitorId}, now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', 200, 100, true, 'test-worker')
    RETURNING id, scheduled_at
  `;
}

const missingId = "00000000-0000-4000-8000-000000000000";
const monitorEndpoints = [
  { method: "GET", path: "" },
  { method: "GET", path: "/stats" },
  { method: "GET", path: "/checks" },
  { method: "GET", path: "/incidents" },
  { method: "GET", path: "/headers" },
  { method: "PUT", path: "/headers", payload: [] },
  { method: "PATCH", path: "", payload: { name: "Updated service" } },
  { method: "POST", path: "/pause" },
  { method: "POST", path: "/resume" },
  { method: "DELETE", path: "" },
] as const;

describe("All endpoints require authentication", () => {
  test.each([
    { method: "GET", url: "/api/monitors" },
    {
      method: "POST",
      url: "/api/monitors",
      payload: { name: "Test service", url: "https://example.com" },
    },
    ...monitorEndpoints.map(({ method, path, ...options }) => ({
      method,
      url: `/api/monitors/${missingId}${path}`,
      ...options,
    })),
  ] as const)("$method $url requires authentication", async (request) => {
    const response = await app.inject(request);

    expect(response.statusCode).toBe(401);
  });
});

describe("Monitor ownership", () => {
  test.each(monitorEndpoints)(
    "$method :id$path returns 404 for another user's monitor",
    async ({ method, path, ...options }) => {
      const owner = await createUserSession();
      const other = await createUserSession(456);
      const monitor = await createTestMonitor(owner.cookies);
      const response = await app.inject({
        method,
        url: `/api/monitors/${monitor.id}${path}`,
        cookies: other.cookies,
        ...options,
      });
      expect(response.statusCode).toBe(404);
      const [stored] =
        await db`SELECT name, paused FROM monitors WHERE id = ${monitor.id}`;
      expect(stored).toEqual({ name: "Test service", paused: false });
    },
  );
});

describe("GET /api/monitors", () => {
  test("GET /api/monitors returns 200", async () => {
    const session = await createUserSession();
    await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: "/api/monitors",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  test("does not list another user's monitors", async () => {
    const owner = await createUserSession();
    const other = await createUserSession(456);
    await createTestMonitor(owner.cookies);
    const response = await app.inject({
      method: "GET",
      url: "/api/monitors",
      cookies: other.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  test.each([
    "search=alpha",
    "search=alpha.example.com",
    "paused=true",
    "method=HEAD",
  ])("filters by %s", async (query) => {
    const session = await createUserSession();
    const alpha = await createTestMonitor(session.cookies, {
      name: "Alpha service",
      url: "https://alpha.example.com",
      method: "HEAD",
    });
    await createTestMonitor(session.cookies, { name: "Beta service" });
    await db`UPDATE monitors SET paused = true WHERE id = ${alpha.id}`;
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors?${query}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().map((monitor: { id: string }) => monitor.id),
    ).toEqual([alpha.id]);
  });

  test("sorts monitors by name", async () => {
    const session = await createUserSession();
    await createTestMonitor(session.cookies, { name: "Beta" });
    await createTestMonitor(session.cookies, { name: "Alpha" });
    const response = await app.inject({
      method: "GET",
      url: "/api/monitors?sort=name&order=asc",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().map((monitor: { name: string }) => monitor.name),
    ).toEqual(["Alpha", "Beta"]);
  });
});

describe("POST /api/monitors", () => {
  test("creates a new monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    expect(monitor.id).toBeDefined();
    expect(monitor).toMatchObject({
      method: "GET",
      intervalSeconds: 60,
      timeoutMs: 10000,
      expectedStatus: 200,
      paused: false,
      status: "unknown",
    });
  });

  test("returns 400 for an invalid monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "POST",
      url: "/api/monitors",
      cookies: session.cookies,
      payload: { name: "Test service", url: "not-a-url" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/monitors/:id", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${missingId}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("GET /api/monitors/:id/checks", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${missingId}/checks`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/checks`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
  });
  test("returns 400 for invalid date range", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/checks?from=2024-06-01T00:00:00Z&to=2024-05-01T00:00:00Z`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(400);
  });

  test("returns saved checks newest first and accepts date/limit filters", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const [older, newer] = await createTestChecks(monitor.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/checks`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((check: { id: string }) => check.id)).toEqual([
      newer.id,
      older.id,
    ]);
    const filtered = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/checks?from=${encodeURIComponent(newer.scheduled_at.toISOString())}&limit=1`,
      cookies: session.cookies,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().map((check: { id: string }) => check.id)).toEqual([
      newer.id,
    ]);
  });
});

describe("GET /api/monitors/:id/incidents", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${missingId}/incidents`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/incidents`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  test("returns saved incidents newest first with a limit", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const incidents = await db`
      INSERT INTO incidents (monitor_id, cause, started_at, resolved_at)
      VALUES
        (${monitor.id}, 'Earlier outage', now() - interval '2 hours', now() - interval '1 hour'),
        (${monitor.id}, 'Current outage', now(), NULL)
      RETURNING id
    `;
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/incidents?limit=1`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().map((incident: { id: string }) => incident.id),
    ).toEqual([incidents[1].id]);
  });
});

describe("PATCH /api/monitors/:id", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/monitors/${missingId}`,
      cookies: session.cookies,
      payload: { name: "Updated service" },
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
      payload: { name: "Updated service" },
    });
    expect(response.statusCode).toBe(200);
    const stored = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
    });
    expect(stored.json()).toMatchObject({
      name: "Updated service",
      url: "https://example.com/health",
      method: "GET",
    });
  });
  test("returns 400 for no changes in payload", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/monitors/:id/pause", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "POST",
      url: `/api/monitors/${missingId}/pause`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for pausing a monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "POST",
      url: `/api/monitors/${monitor.id}/pause`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().paused).toBe(true);
  });
});

describe("POST /api/monitors/:id/resume", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "POST",
      url: `/api/monitors/${missingId}/resume`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for resuming a monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const [paused] = await db`
      UPDATE monitors SET paused = true, next_run_at = now() + interval '1 day'
      WHERE id = ${monitor.id} RETURNING next_run_at
    `;
    const response = await app.inject({
      method: "POST",
      url: `/api/monitors/${monitor.id}/resume`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().paused).toBe(false);
    expect(Date.parse(response.json().nextRunAt)).toBeLessThan(
      paused.next_run_at.getTime(),
    );
  });
});

describe("DELETE /api/monitors/:id", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "DELETE",
      url: `/api/monitors/${missingId}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 204 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(204);
    const deleted = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}`,
      cookies: session.cookies,
    });
    expect(deleted.statusCode).toBe(404);
  });
});

describe("GET /api/monitors/:id/stats", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${missingId}/stats`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/stats`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      uptime24h: null,
      uptime7d: null,
      avgLatencyMs24h: null,
      checks24h: 0,
    });
  });

  test("returns stats from saved checks", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    await createTestChecks(monitor.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/stats`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      uptime24h: 50,
      uptime7d: 50,
      avgLatencyMs24h: 150,
      checks24h: 2,
    });
  });
});

describe("PUT /api/monitors/:id/headers", () => {
  test("preserves omitted secret values, replaces the list, and clears it", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const url = `/api/monitors/${monitor.id}/headers`;
    const initial = await app.inject({
      method: "PUT",
      url,
      cookies: session.cookies,
      payload: [
        { name: "Authorization", value: "Bearer test-token", isSecret: true },
        { name: "Accept", value: "application/json", isSecret: false },
      ],
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toContainEqual({
      name: "Accept",
      value: "application/json",
      isSecret: false,
    });
    const [before] = await db`
      SELECT value_encrypted FROM monitor_headers
      WHERE monitor_id = ${monitor.id} AND name = 'Authorization'
    `;
    const replaced = await app.inject({
      method: "PUT",
      url,
      cookies: session.cookies,
      payload: [{ name: "Authorization", isSecret: true }],
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toEqual([
      { name: "Authorization", value: "••••••", isSecret: true },
    ]);
    const stored =
      await db`SELECT name, value_encrypted FROM monitor_headers WHERE monitor_id = ${monitor.id}`;
    expect(stored).toHaveLength(1);
    expect(stored[0].value_encrypted).toEqual(before.value_encrypted);
    const cleared = await app.inject({
      method: "PUT",
      url,
      cookies: session.cookies,
      payload: [],
    });
    expect(cleared.statusCode).toBe(200);
    const response = await app.inject({
      method: "GET",
      url,
      cookies: session.cookies,
    });
    expect(response.json()).toEqual([]);
  });

  test.each([
    { name: "Bad Header", value: "value" },
    { name: "X-Test-Header", value: "bad\r\nvalue" },
    { name: "X-Test-Header" },
  ])("returns 400 for invalid header input: $name $value", async (header) => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "PUT",
      url: `/api/monitors/${monitor.id}/headers`,
      cookies: session.cookies,
      payload: [header],
    });
    expect(response.statusCode).toBe(400);
  });

  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "PUT",
      url: `/api/monitors/${missingId}/headers`,
      cookies: session.cookies,
      payload: [{ name: "X-Test-Header", value: "value", isSecret: true }],
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "PUT",
      url: `/api/monitors/${monitor.id}/headers`,
      cookies: session.cookies,
      payload: [{ name: "X-Test-Header", value: "value", isSecret: true }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { name: "X-Test-Header", value: "••••••", isSecret: true },
    ]);
    const stored = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/headers`,
      cookies: session.cookies,
    });
    expect(stored.json()).toEqual(response.json());
    const [header] =
      await db`SELECT value_encrypted FROM monitor_headers WHERE monitor_id = ${monitor.id}`;
    expect(header.value_encrypted.toString("utf8")).not.toBe("value");
  });
  test("returns 400 for duplicate headers", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "PUT",
      url: `/api/monitors/${monitor.id}/headers`,
      cookies: session.cookies,
      payload: [
        { name: "X-Test-Header", value: "value", isSecret: true },
        { name: "x-test-header", value: "other value", isSecret: true },
      ],
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/monitors/:id/headers", () => {
  test("returns 404 for missing monitor", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${missingId}/headers`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
  test("returns 200 for existing monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitor.id}/headers`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
  });
});
