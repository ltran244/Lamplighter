import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { OAUTH_STATE_COOKIE } from "../src/routes/auth.js";
import { SESSION_COOKIE } from "../src/session.js";

const app = buildApp();
const githubUser = { id: 123, login: "test-user" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  await db`DELETE FROM users`;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);

  // Mock HTTP only: Arctic and all application/database code still run.
  fetchMock.mockImplementation(async (input, init) => {
    const { url } = new Request(input, init);
    if (url === "https://github.com/login/oauth/access_token") {
      return Response.json({
        access_token: "test-token",
        token_type: "bearer",
      });
    }
    if (url === "https://api.github.com/user") {
      return Response.json(githubUser);
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  try {
    await db`DELETE FROM users`;
  } finally {
    await app.close();
  }
});

async function startLogin() {
  const response = await app.inject({ method: "GET", url: "/auth/github" });
  expect(response.statusCode).toBe(302);

  const location = new URL(response.headers.location!);
  expect(location.origin + location.pathname).toBe(
    "https://github.com/login/oauth/authorize",
  );
  const stateCookie = response.cookies.find(
    (c) => c.name === OAUTH_STATE_COOKIE,
  )!;
  expect(stateCookie.value).toBeTruthy();
  expect(stateCookie.value).toBe(location.searchParams.get("state"));
  return stateCookie.value;
}

async function login() {
  const state = await startLogin();
  return app.inject({
    method: "GET",
    url: `/auth/github/callback?code=test-code&state=${encodeURIComponent(state)}`,
    cookies: { [OAUTH_STATE_COOKIE]: state },
  });
}

test("GitHub login creates a user and session, sets a cookie, and redirects to the app", async () => {
  const response = await login();

  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(process.env.FRONTEND_URL);

  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)!;
  expect(cookie.value).toBeTruthy();

  const [user] = await db`SELECT id, github_id, username FROM users`;
  expect(String(user.github_id)).toBe(String(githubUser.id));
  expect(user.username).toBe(githubUser.login);

  const [session] = await db`SELECT id, user_id, expires_at FROM sessions`;
  expect(session.id).toBe(cookie.value);
  expect(session.user_id).toBe(user.id);
  expect(session.expires_at.getTime()).toBeGreaterThan(Date.now());
});

test("returning GitHub users keep their ID and get their username updated", async () => {
  const [existingUser] = await db`
    INSERT INTO users (github_id, username)
    VALUES (${githubUser.id}, 'old-username')
    RETURNING id
  `;

  const response = await login();
  expect(response.statusCode).toBe(302);

  const users = await db`SELECT id, username FROM users`;
  expect(users).toHaveLength(1);
  expect(users[0]).toEqual({ id: existingUser.id, username: githubUser.login });
  const [session] = await db`SELECT user_id FROM sessions`;
  expect(session.user_id).toBe(existingUser.id);
});

test("invalid state rejects login without creating a user or session", async () => {
  const state = await startLogin();
  const response = await app.inject({
    method: "GET",
    url: "/auth/github/callback?code=test-code&state=wrong-state",
    cookies: { [OAUTH_STATE_COOKIE]: state },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: "invalid_oauth_state" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(response.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(false);
  expect(await db`SELECT id FROM users`).toHaveLength(0);
  expect(await db`SELECT id FROM sessions`).toHaveLength(0);
});

test("logout revokes only the current session and clears both cookies", async () => {
  const firstLogin = await login();
  const secondLogin = await login();
  expect(firstLogin.statusCode).toBe(302);
  expect(secondLogin.statusCode).toBe(302);
  const sessionId = firstLogin.cookies.find(
    (c) => c.name === SESSION_COOKIE,
  )!.value;
  const otherSessionId = secondLogin.cookies.find(
    (c) => c.name === SESSION_COOKIE,
  )!.value;

  const response = await app.inject({
    method: "POST",
    url: "/auth/logout",
    cookies: { [SESSION_COOKIE]: sessionId },
  });
  expect(response.statusCode).toBe(204);
  expect(response.body).toBe("");
  expect(await db`SELECT id FROM sessions`).toEqual([{ id: otherSessionId }]);
  expect(await db`SELECT id FROM users`).toHaveLength(1);

  for (const name of [SESSION_COOKIE, OAUTH_STATE_COOKIE]) {
    const cookie = response.cookies.find((c) => c.name === name)!;
    expect(cookie.value).toBe("");
  }
});
