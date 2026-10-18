import { db } from "../db.js";

export type CreateMonitorInput = {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
};

export type UpdateMonitorInput = Partial<CreateMonitorInput>;

export type MonitorFilters = {
  search?: string;
  paused?: boolean;
  method?: "GET" | "HEAD";
  sort?: "name" | "createdAt";
  order?: "asc" | "desc";
};

type Monitor = {
  id: string;
  userId: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
  paused: boolean;
  createdAt: Date;
};

const monitorColumns = db`
  id, user_id AS "userId", name, url, method,
  interval_seconds AS "intervalSeconds", timeout_ms AS "timeoutMs",
  expected_status AS "expectedStatus", paused, created_at AS "createdAt"
`;

export async function createMonitor(userId: string, input: CreateMonitorInput) {
  const [monitor] = await db<Monitor[]>`
    INSERT INTO monitors
      (user_id, name, url, method, interval_seconds, timeout_ms, expected_status)
    VALUES (
      ${userId}, ${input.name}, ${input.url}, ${input.method},
      ${input.intervalSeconds}, ${input.timeoutMs},
      ${input.expectedStatus}
    )
    RETURNING ${monitorColumns}
  `;
  return monitor;
}

export async function getMonitors(
  userId: string,
  filters: MonitorFilters = {},
) {
  const search = filters.search?.trim() ?? "";
  const sortColumn = filters.sort === "name" ? db`lower(name)` : db`created_at`;
  const sortDirection = filters.order === "asc" ? db`ASC` : db`DESC`;
  return db<Monitor[]>`
    SELECT ${monitorColumns}
    FROM monitors
    WHERE user_id = ${userId}
      AND paused = COALESCE(${filters.paused ?? null}, paused)
      AND method = COALESCE(${filters.method ?? null}, method)
      AND (
        strpos(lower(name), lower(${search})) > 0
        OR strpos(lower(url), lower(${search})) > 0
      )
    ORDER BY ${sortColumn} ${sortDirection}, id ${sortDirection}
  `;
}

export async function getMonitor(userId: string, monitorId: string) {
  const [monitor] = await db<Monitor[]>`
    SELECT ${monitorColumns}
    FROM monitors
    WHERE id = ${monitorId} AND user_id = ${userId}
  `;
  return monitor;
}

export async function updateMonitor(
  userId: string,
  monitorId: string,
  input: UpdateMonitorInput,
) {
  const [monitor] = await db<Monitor[]>`
    UPDATE monitors SET
      name = COALESCE(${input.name ?? null}, name),
      url = COALESCE(${input.url ?? null}, url),
      method = COALESCE(${input.method ?? null}, method),
      interval_seconds = COALESCE(${input.intervalSeconds ?? null}, interval_seconds),
      timeout_ms = COALESCE(${input.timeoutMs ?? null}, timeout_ms),
      expected_status = COALESCE(${input.expectedStatus ?? null}, expected_status)
    WHERE id = ${monitorId} AND user_id = ${userId}
    RETURNING ${monitorColumns}
  `;
  return monitor;
}

export async function setMonitorPaused(
  userId: string,
  monitorId: string,
) {
  // TODO: Reset next_run_at on resume when worker scheduling is wired up.
  const [monitor] = await db<Monitor[]>`
    UPDATE monitors SET paused = true
    WHERE id = ${monitorId} AND user_id = ${userId}
    RETURNING ${monitorColumns}
  `;
  return monitor;
}

export async function setMonitorResumed(
  userId: string,
  monitorId: string,
) {
  const [monitor] = await db<Monitor[]>`
    UPDATE monitors SET paused = false
    WHERE id = ${monitorId} AND user_id = ${userId}
    RETURNING ${monitorColumns}
  `;
  return monitor;
}

export async function deleteMonitor(userId: string, monitorId: string) {
  const deleted = await db`
    DELETE FROM monitors
    WHERE id = ${monitorId} AND user_id = ${userId}
    RETURNING id
  `;
  return deleted.length > 0;
}
