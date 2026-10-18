import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { monitorRoutes } from "./routes/monitors.js";
export function buildApp() {
  const app = Fastify({ logger: true });

  app.decorateRequest("user", null);
  app.register(cookie);
  app.register(authRoutes);
  app.register(monitorRoutes);

  app.get("/health", async (request, reply) => {
    try {
      await db`SELECT 1`;
      return { db: "up" };
    } catch (err) {
      request.log.error({ err }, "database ping failed");
      return reply.code(503).send({ db: "down" });
    }
  });

  app.addHook("onClose", async () => {
    await db.end();
  });

  return app;
}
