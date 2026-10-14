import type { FastifyInstance } from "fastify";
import { generateState, OAuth2RequestError } from "arctic";
import { config } from "../config.js";
import { github } from "../github.js";
import { upsertGithubUser } from "../queries/auth.js";
import { createSession, deleteSession } from "../queries/sessions.js";
import { parseSessionId, SESSION_COOKIE } from "../session.js";
export const OAUTH_STATE_COOKIE = "github_oauth_state";

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/github", (_req, reply) => {
    const state = generateState();
    const url = github.createAuthorizationURL(state, []);

    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      path: "/auth/github",
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
      maxAge: 60 * 10, // 10 minutes to get callback from GitHub
    });

    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/github/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      const oauthState = req.cookies[OAUTH_STATE_COOKIE];
      reply.header("Cache-Control", "no-store");
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/auth/github" });

      if (error || !code || !state || state !== oauthState) {
        return reply.code(400).send();
      }

      try {
        const tokens = await github.validateAuthorizationCode(code);
        const response = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokens.accessToken()}`,
            "User-Agent": "Lamplighter",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          req.log.error(
            { status: response.status },
            "GitHub profile request failed",
          );
          return reply.code(502).send();
        }

        const githubUser = (await response.json()) as {
          id: number;
          login: string;
        };
        const user = await upsertGithubUser(githubUser.id, githubUser.login);

        const maxAge = 60 * 60 * 24 * 30; // 30 days, in seconds
        const expiresAt = new Date(Date.now() + maxAge * 1000);
        const session = await createSession(user.id, expiresAt);

        reply.setCookie(SESSION_COOKIE, session.id, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: config.nodeEnv === "production",
          maxAge,
        });

        return reply.redirect(
          process.env.FRONTEND_URL ?? "http://localhost:5173",
        );
      } catch (err) {
        req.log.error({ err }, "GitHub login failed");
        return reply.code(err instanceof OAuth2RequestError ? 400 : 500).send();
      }
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      const sessionId = parseSessionId(req.cookies[SESSION_COOKIE]);
      if (sessionId) await deleteSession(sessionId);

      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/auth/github" });
      return reply.code(204).send();
    } catch (err) {
      req.log.error({ err }, "Logout failed");
      return reply.code(500).send({ error: "logout_failed" });
    }
  });
}
