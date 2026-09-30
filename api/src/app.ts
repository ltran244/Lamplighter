import Fastify from "fastify";
import { db } from "./db.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async (request, reply) => {
    try {
      await db`SELECT 1`;
      return { ok: true, db: "up" };
    } catch (err) {
      request.log.error({ err }, "database ping failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });

  app.addHook("onClose", async () => {
    await db.end();
  });

  return app;
}
