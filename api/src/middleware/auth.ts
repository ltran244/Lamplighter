import type { FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser, type SessionUser } from "../queries/sessions.js";
import { parseSessionId, SESSION_COOKIE } from "../session.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sessionId = parseSessionId(req.cookies[SESSION_COOKIE]);
  const user = sessionId ? await getSessionUser(sessionId) : undefined;

  if (!user) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "Authentication required. Please sign in.",
    });
  }

  req.user = user;
}
