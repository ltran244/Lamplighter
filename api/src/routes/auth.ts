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

      if (error) {
        return reply.code(400).send({
          error: "oauth_authorization_failed",
          message:
            "GitHub authorization failed or was denied. Please try signing in again.",
        });
      }
      if (!code) {
        return reply.code(400).send({
          error: "missing_oauth_code",
          message: "The GitHub callback is missing the authorization code.",
        });
      }
      if (!state) {
        return reply.code(400).send({
          error: "missing_oauth_state",
          message: "The GitHub callback is missing the login state.",
        });
      }
      if (!oauthState) {
        return reply.code(400).send({
          error: "missing_oauth_state_cookie",
          message:
            "The login state cookie is missing or expired. Please start signing in again.",
        });
      }
      if (state !== oauthState) {
        return reply.code(400).send({
          error: "invalid_oauth_state",
          message:
            "The login state does not match. Please start signing in again.",
        });
      }

      try {
        const tokens = await github.validateAuthorizationCode(code);
        const response = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokens.accessToken()}`,
            "User-Agent": "Lamplighter",
          },
          signal: AbortSignal.timeout(10_000), // 10 second timeout
        });
        if (!response.ok) {
          req.log.error(
            { status: response.status },
            "GitHub profile request failed",
          );
          return reply.code(502).send({
            error: "github_profile_failed",
            message:
              "Unable to retrieve your GitHub profile. Please try signing in again.",
          });
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
        // Redirect to frontend after setting the session cookie
        return reply.redirect(
          process.env.FRONTEND_URL ?? "http://localhost:5173",
        );
      } catch (err) {
        req.log.error({ err }, "GitHub login failed");
        if (err instanceof OAuth2RequestError) {
          return reply.code(400).send({
            error: "oauth_code_rejected",
            message:
              "GitHub rejected the authorization code exchange. Please try signing in again.",
          });
        }
        return reply.code(500).send({
          error: "internal_error",
          message: "Unable to complete sign-in. Please try again later.",
        });
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
      return reply.code(500).send({
        error: "logout_failed",
        message: "Unable to logout. Please try again later.",
      });
    }
  });
}
