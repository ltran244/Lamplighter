import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
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

async function createTestIncident(userId: string, resolved = false) {
  const [monitor] = await db`
    INSERT INTO monitors (user_id, name, url)
    VALUES (${userId}, 'Test service', 'https://example.com/health')
    RETURNING id
  `;
  const [incident] = await db`
    INSERT INTO incidents (monitor_id, cause, started_at, resolved_at)
    VALUES (${monitor.id}, 'Test outage', now() - interval '1 hour',
      CASE WHEN ${resolved} THEN now() ELSE NULL END)
    RETURNING id
  `;
  return incident;
}

describe("GET /api/incidents", () => {
  test.each(["open", "resolved"] as const)(
    "filters %s incidents",
    async (status) => {
      const session = await createUserSession();
      const open = await createTestIncident(session.userId);
      const resolved = await createTestIncident(session.userId, true);
      const response = await app.inject({
        method: "GET",
        url: `/api/incidents?status=${status}&limit=1`,
        cookies: session.cookies,
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json().map((incident: { id: string }) => incident.id),
      ).toEqual([status === "open" ? open.id : resolved.id]);
    },
  );

  test("limits the number of incidents", async () => {
    const session = await createUserSession();
    await createTestIncident(session.userId);
    await createTestIncident(session.userId, true);
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents?limit=1",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  test("does not list another user's incidents", async () => {
    const owner = await createUserSession();
    const other = await createUserSession(456);
    await createTestIncident(owner.userId);
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents",
      cookies: other.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  test("returns 400 for invalid status", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents?status=invalid",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(400);
  });

  test("returns 400 for invalid limit", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents?limit=0",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(400);
  });

  test("returns 401 without authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents",
    });
    expect(response.statusCode).toBe(401);
  });

  test("returns 200 with no incidents", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: "/api/incidents",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  test("returns 200 with existing incidents", async () => {
    const session = await createUserSession();
    const monitorResponse = await app.inject({
      method: "POST",
      url: "/api/monitors",
      cookies: session.cookies,
      payload: { name: "Test service", url: "https://example.com/health" },
    });
    expect(monitorResponse.statusCode).toBe(201);
    const monitor = monitorResponse.json<{ id: string }>();
    await db`
      INSERT INTO incidents (monitor_id, cause)
      VALUES (${monitor.id}, 'expected HTTP 200, received HTTP 503')
    `;

    const response = await app.inject({
      method: "GET",
      url: "/api/incidents",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].monitor).toEqual({
      id: monitor.id,
      name: "Test service",
    });
  });
});
