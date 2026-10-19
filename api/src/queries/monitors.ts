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

export type MonitorCheckFilters = {
  from?: string;
  to?: string;
  limit?: number;
};

type MonitorCheck = {
  id: string;
  scheduledAt: Date;
  startedAt: Date;
  finishedAt: Date;
  statusCode: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
};

type MonitorIncident = {
  id: string;
  startedAt: Date;
  resolvedAt: Date | null;
  durationSeconds: number;
  cause: string;
};

type MonitorStats = {
  uptime24h: number | null;
  uptime7d: number | null;
  avgLatencyMs24h: number | null;
  checks24h: number;
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
  status: "unknown" | "up" | "down";
  consecutiveFailures: number;
  nextRunAt: Date;
  createdAt: Date;
};

const monitorColumns = db`
  id, user_id AS "userId", name, url, method,
  interval_seconds AS "intervalSeconds", timeout_ms AS "timeoutMs",
  expected_status AS "expectedStatus", paused, status,
  consecutive_failures AS "consecutiveFailures", next_run_at AS "nextRunAt",
  created_at AS "createdAt"
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

export async function setMonitorPaused(userId: string, monitorId: string) {
  const [monitor] = await db<Monitor[]>`
    UPDATE monitors SET paused = true
    WHERE id = ${monitorId} AND user_id = ${userId}
    RETURNING ${monitorColumns}
  `;
  return monitor;
}

export async function setMonitorResumed(userId: string, monitorId: string) {
  const [monitor] = await db<Monitor[]>`
    UPDATE monitors
    SET next_run_at = CASE WHEN paused THEN now() ELSE next_run_at END,
      paused = false
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

export async function getMonitorStats(userId: string, monitorId: string) {
  // return monitor stats for the last 24 hours and 7 days
  const [stats] = await db<MonitorStats[]>`
    SELECT
      (100 * avg(c.ok::integer) FILTER (
        WHERE c.scheduled_at >= now() - interval '24 hours'
      ))::double precision AS "uptime24h",
      (100 * avg(c.ok::integer))::double precision AS "uptime7d",
      (avg(c.latency_ms) FILTER (
        WHERE c.scheduled_at >= now() - interval '24 hours'
      ))::double precision AS "avgLatencyMs24h",
      (count(c.id) FILTER (
        WHERE c.scheduled_at >= now() - interval '24 hours'
      ))::integer AS "checks24h"
    FROM monitors m
    LEFT JOIN check_runs c ON c.monitor_id = m.id
      AND c.scheduled_at >= now() - interval '7 days'
      AND c.scheduled_at <= now()
    WHERE m.id = ${monitorId} AND m.user_id = ${userId}
    GROUP BY m.id
  `;
  return stats;
}

export async function getMonitorChecks(
  userId: string,
  monitorId: string,
  filters: MonitorCheckFilters = {},
) {
  return db<MonitorCheck[]>`
    SELECT c.id, c.scheduled_at AS "scheduledAt", c.actual_start AS "startedAt",
      c.finished_at AS "finishedAt", c.status_code AS "statusCode",
      c.latency_ms AS "latencyMs", c.ok, c.error
    FROM check_runs c
    JOIN monitors m ON m.id = c.monitor_id
    WHERE c.monitor_id = ${monitorId} AND m.user_id = ${userId}
      AND c.scheduled_at >= COALESCE(${filters.from ?? null}::timestamptz, c.scheduled_at)
      AND c.scheduled_at <= COALESCE(${filters.to ?? null}::timestamptz, c.scheduled_at)
    ORDER BY c.scheduled_at DESC, c.id DESC
    LIMIT ${filters.limit ?? 100}
  `;
}

export async function getMonitorIncidents(
  userId: string,
  monitorId: string,
  limit = 100,
) {
  return db<MonitorIncident[]>`
    SELECT i.id, i.started_at AS "startedAt", i.resolved_at AS "resolvedAt",
      floor(extract(epoch FROM (COALESCE(i.resolved_at, now()) - i.started_at)))::double precision AS "durationSeconds",
      i.cause
    FROM incidents i
    JOIN monitors m ON m.id = i.monitor_id
    WHERE i.monitor_id = ${monitorId} AND m.user_id = ${userId}
    ORDER BY i.started_at DESC, i.id DESC
    LIMIT ${limit}
  `;
}
