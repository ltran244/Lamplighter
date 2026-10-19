import type { FastifyError, FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  createAlertChannel,
  deleteAlertChannel,
  getAlertChannel,
  getAlertChannels,
  updateAlertChannel,
  type AlertChannelInput,
} from "../queries/alert-channels.js";

type AlertChannelParams = { id: string };

const channelParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const channelBody = {
  type: "object",
  required: ["target"],
  additionalProperties: false,
  properties: {
    target: { type: "string", format: "email", maxLength: 254 },
  },
};

export async function alertChannelRoutes(app: FastifyInstance) {
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

    req.log.error({ err: error }, "Alert channel request failed");
    return reply.code(500).send({
      error: "internal_error",
      message:
        "Unable to complete the alert channel request. Please try again later.",
    });
  });

  app.get("/api/alert-channels", async (req) => {
    return getAlertChannels(req.user!.id);
  });

  app.post<{ Body: AlertChannelInput }>(
    "/api/alert-channels",
    { schema: { body: channelBody } },
    async (req, reply) => {
      const channel = await createAlertChannel(req.user!.id, req.body);
      return reply.code(201).send(channel);
    },
  );

  app.get<{ Params: AlertChannelParams }>(
    "/api/alert-channels/:id",
    { schema: { params: channelParams } },
    async (req, reply) => {
      const channel = await getAlertChannel(req.user!.id, req.params.id);
      if (!channel) {
        return reply.code(404).send({
          error: "alert_channel_not_found",
          message: "Alert channel not found.",
        });
      }
      return channel;
    },
  );

  app.patch<{ Params: AlertChannelParams; Body: AlertChannelInput }>(
    "/api/alert-channels/:id",
    { schema: { params: channelParams, body: channelBody } },
    async (req, reply) => {
      const channel = await updateAlertChannel(
        req.user!.id,
        req.params.id,
        req.body,
      );
      if (!channel) {
        return reply.code(404).send({
          error: "alert_channel_not_found",
          message: "Alert channel not found.",
        });
      }
      return channel;
    },
  );

  app.delete<{ Params: AlertChannelParams }>(
    "/api/alert-channels/:id",
    { schema: { params: channelParams } },
    async (req, reply) => {
      const deleted = await deleteAlertChannel(req.user!.id, req.params.id);
      if (!deleted) {
        return reply.code(404).send({
          error: "alert_channel_not_found",
          message: "Alert channel not found.",
        });
      }
      return reply.code(204).send();
    },
  );
}
