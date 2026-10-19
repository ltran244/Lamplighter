import type { FastifyError, FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { getIncidents, type IncidentFilters } from "../queries/incidents.js";

export async function incidentRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.addHook("onRequest", requireAuth);

  app.setErrorHandler<FastifyError>((error, req, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: error.validation ? "validation_error" : "invalid_request",
        message: error.message,
      });
    }
    req.log.error({ err: error }, "Incident request failed");
    return reply.code(500).send({
      error: "internal_error",
      message: "Unable to retrieve incidents. Please try again later.",
    });
  });

  app.get<{ Querystring: IncidentFilters }>(
    "/api/incidents",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["open", "resolved"] },
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
          },
        },
      },
    },
    async (req) => getIncidents(req.user!.id, req.query),
  );
}
