import type { FastifyError, FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  getMonitorChecks,
  getMonitorIncidents,
  getMonitors,
  setMonitorPaused,
  setMonitorResumed,
  updateMonitor,
  type CreateMonitorInput,
  type MonitorCheckFilters,
  type MonitorFilters,
  type UpdateMonitorInput,
} from "../queries/monitors.js";

// TypeScript describes req.params; Fastify's schema validates it at runtime.
type MonitorParams = { id: string };

// Schema for monitor params/id used in routes with :id
const monitorParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const historyLimit = {
  type: "integer",
  minimum: 1,
  maximum: 1000,
  default: 100,
};

// No defaults for PATCH
const monitorProperties = {
  name: { type: "string", minLength: 1, pattern: "\\S" },
  url: { type: "string", format: "uri", pattern: "^https?://" },
  method: { type: "string", enum: ["GET", "HEAD"] },
  intervalSeconds: { type: "integer", minimum: 30 },
  timeoutMs: { type: "integer", minimum: 1, maximum: 30000 }, // 30s
  expectedStatus: { type: "integer", minimum: 100, maximum: 599 },
};

export async function monitorRoutes(app: FastifyInstance) {
  // Disable caching for all monitor routes
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

    req.log.error({ err: error }, "Monitor request failed");
    return reply.code(500).send({
      error: "internal_error",
      message:
        "Unable to complete the monitor request. Please try again later.",
    });
  });

  app.get<{ Querystring: MonitorFilters }>(
    "/api/monitors",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string" },
            paused: { type: "boolean" },
            method: { type: "string", enum: ["GET", "HEAD"] },
            sort: {
              type: "string",
              enum: ["name", "createdAt"],
              default: "createdAt",
            },
            order: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
        },
      },
    },
    async (req) => {
      const monitors = await getMonitors(req.user!.id, req.query);
      return monitors;
    },
  );

  app.post<{ Body: CreateMonitorInput }>(
    "/api/monitors",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "url"],
          additionalProperties: false,
          properties: {
            // Because PATCH has no defaults, we set them here for POST
            ...monitorProperties,
            method: { ...monitorProperties.method, default: "GET" },
            intervalSeconds: {
              ...monitorProperties.intervalSeconds,
              default: 60,
            },
            timeoutMs: { ...monitorProperties.timeoutMs, default: 10000 },
            expectedStatus: {
              ...monitorProperties.expectedStatus,
              default: 200,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const monitor = await createMonitor(req.user!.id, req.body);
      return reply.code(201).send(monitor);
    },
  );

  app.get<{ Params: MonitorParams }>(
    "/api/monitors/:id",
    { schema: { params: monitorParams } },
    async (req, reply) => {
      const monitor = await getMonitor(req.user!.id, req.params.id);
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      return monitor;
    },
  );

  app.get<{ Params: MonitorParams; Querystring: MonitorCheckFilters }>(
    "/api/monitors/:id/checks",
    {
      schema: {
        params: monitorParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            limit: historyLimit,
          },
        },
      },
    },
    async (req, reply) => {
      const monitor = await getMonitor(req.user!.id, req.params.id);
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      if (
        req.query.from &&
        req.query.to &&
        Date.parse(req.query.from) > Date.parse(req.query.to)
      ) {
        return reply.code(400).send({
          error: "invalid_date_range",
          message:
            "The from timestamp must be before or equal to the to timestamp.",
        });
      }
      const checks = await getMonitorChecks(req.user!.id, req.params.id, req.query);
      if (!checks) {
        return reply.code(404).send({
          error: "checks_not_found",
          message: "No checks found for this monitor.",
        });
      }
      return checks;
    },
  );

  app.get<{ Params: MonitorParams; Querystring: { limit?: number } }>(
    "/api/monitors/:id/incidents",
    {
      schema: {
        params: monitorParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: historyLimit },
        },
      },
    },
    async (req, reply) => {
      const monitor = await getMonitor(req.user!.id, req.params.id);
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      const incidents = await getMonitorIncidents(req.user!.id, req.params.id, req.query.limit);
      if (!incidents) {
        return reply.code(404).send({
          error: "incidents_not_found",
          message: "No incidents found for this monitor.",
        });
      }
      return incidents  ;
    },
  );

  app.patch<{ Params: MonitorParams; Body: UpdateMonitorInput }>(
    "/api/monitors/:id",
    {
      schema: {
        params: monitorParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: monitorProperties,
        },
      },
    },
    async (req, reply) => {
      if (Object.keys(req.body).length === 0) {
        return reply.code(400).send({
          error: "empty_monitor_update",
          message: "Provide at least one monitor setting to update.",
        });
      }

      const monitor = await updateMonitor(
        req.user!.id,
        req.params.id,
        req.body,
      );
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      return monitor;
    },
  );

  app.post<{ Params: MonitorParams }>(
    "/api/monitors/:id/pause",
    { schema: { params: monitorParams } },
    async (req, reply) => {
      const monitor = await setMonitorPaused(req.user!.id, req.params.id);
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      return monitor;
    },
  );

  app.post<{ Params: MonitorParams }>(
    "/api/monitors/:id/resume",
    { schema: { params: monitorParams } },
    async (req, reply) => {
      const monitor = await setMonitorResumed(req.user!.id, req.params.id);
      if (!monitor) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      return monitor;
    },
  );

  app.delete<{ Params: MonitorParams }>(
    "/api/monitors/:id",
    { schema: { params: monitorParams } },
    async (req, reply) => {
      const deleted = await deleteMonitor(req.user!.id, req.params.id);
      if (!deleted) {
        return reply.code(404).send({
          error: "monitor_not_found",
          message: "Monitor not found.",
        });
      }
      return reply.code(204).send();
    },
  );

  // TODO: Implement /:id/stats using check_runs.
  // TODO: Implement /:id/headers GET/PUT with encryption and secret masking.
}
