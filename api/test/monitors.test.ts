import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { upsertGithubUser } from "../src/queries/auth.js";
import type { CreateMonitorInput } from "../src/queries/monitors.js";
import { createSession } from "../src/queries/sessions.js";
import { SESSION_COOKIE } from "../src/session.js";

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

async function createUserSession(githubId = 123) {
  const user = await upsertGithubUser(githubId, `test-user-${githubId}`);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const session = await createSession(user.id, expiresAt);

  return {
    userId: user.id,
    cookies: { [SESSION_COOKIE]: session.id },
  };
}

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

const missingId = "00000000-0000-4000-8000-000000000000";
const monitorEndpoints = [
  { method: "GET", path: "" },
  { method: "GET", path: "/checks" },
  { method: "GET", path: "/incidents" },
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
});

describe("POST /api/monitors", () => {
  test("creates a new monitor", async () => {
    const session = await createUserSession();
    const monitor = await createTestMonitor(session.cookies);
    expect(monitor.id).toBeDefined();
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
    const response = await app.inject({
      method: "POST",
      url: `/api/monitors/${monitor.id}/resume`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
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
  });
});
