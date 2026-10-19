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

async function createTestChannel(cookies: Record<string, string>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/alert-channels",
    cookies,
    payload: { target: "alerts@example.com" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

const missingId = "00000000-0000-4000-8000-000000000000";

describe("All endpoints require authentication", () => {
  test.each([
    { method: "GET", url: "/api/alert-channels" },
    {
      method: "POST",
      url: "/api/alert-channels",
      payload: { target: "alerts@example.com" },
    },
    { method: "GET", url: `/api/alert-channels/${missingId}` },
    {
      method: "PATCH",
      url: `/api/alert-channels/${missingId}`,
      payload: { target: "updated@example.com" },
    },
    { method: "DELETE", url: `/api/alert-channels/${missingId}` },
  ] as const)("$method $url requires authentication", async (request) => {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/alert-channels", () => {
  test("returns 200", async () => {
    const session = await createUserSession();
    await createTestChannel(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: "/api/alert-channels",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });
});

describe("POST /api/alert-channels", () => {
  test("creates a new alert channel", async () => {
    const session = await createUserSession();
    const channel = await createTestChannel(session.cookies);
    expect(channel.id).toBeDefined();
  });
});

describe("GET /api/alert-channels/:id", () => {
  test("returns 404 for missing channel", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "GET",
      url: `/api/alert-channels/${missingId}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  test("returns 200 for existing channel", async () => {
    const session = await createUserSession();
    const channel = await createTestChannel(session.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/api/alert-channels/${channel.id}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("PATCH /api/alert-channels/:id", () => {
  test("returns 404 for missing channel", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/alert-channels/${missingId}`,
      cookies: session.cookies,
      payload: { target: "updated@example.com" },
    });
    expect(response.statusCode).toBe(404);
  });

  test("returns 200 for existing channel", async () => {
    const session = await createUserSession();
    const channel = await createTestChannel(session.cookies);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/alert-channels/${channel.id}`,
      cookies: session.cookies,
      payload: { target: "updated@example.com" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("DELETE /api/alert-channels/:id", () => {
  test("returns 404 for missing channel", async () => {
    const session = await createUserSession();
    const response = await app.inject({
      method: "DELETE",
      url: `/api/alert-channels/${missingId}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  test("returns 204 for existing channel", async () => {
    const session = await createUserSession();
    const channel = await createTestChannel(session.cookies);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/alert-channels/${channel.id}`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(204);
  });
});
