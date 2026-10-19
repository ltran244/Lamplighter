import { db } from "../db.js";

export type AlertChannelInput = { target: string };

type AlertChannel = {
  id: string;
  type: "email";
  target: string;
};

export async function getAlertChannels(userId: string) {
  return db<AlertChannel[]>`
    SELECT id, type, target FROM alert_channels
    WHERE user_id = ${userId}
    ORDER BY target, id
  `;
}

export async function getAlertChannel(userId: string, channelId: string) {
  const [channel] = await db<AlertChannel[]>`
    SELECT id, type, target FROM alert_channels
    WHERE id = ${channelId} AND user_id = ${userId}
  `;
  return channel;
}

export async function createAlertChannel(
  userId: string,
  input: AlertChannelInput,
) {
  const [channel] = await db<AlertChannel[]>`
    INSERT INTO alert_channels (user_id, target)
    VALUES (${userId}, ${input.target})
    RETURNING id, type, target
  `;
  return channel;
}

export async function updateAlertChannel(
  userId: string,
  channelId: string,
  input: AlertChannelInput,
) {
  const [channel] = await db<AlertChannel[]>`
    UPDATE alert_channels SET target = ${input.target}
    WHERE id = ${channelId} AND user_id = ${userId}
    RETURNING id, type, target
  `;
  return channel;
}

export async function deleteAlertChannel(userId: string, channelId: string) {
  const deleted = await db`
    DELETE FROM alert_channels
    WHERE id = ${channelId} AND user_id = ${userId}
    RETURNING id
  `;
  return deleted.length > 0;
}
