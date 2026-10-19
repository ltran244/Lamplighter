import { db } from "../db.js";

export type IncidentFilters = {
  status?: "open" | "resolved";
  limit?: number;
};

type Incident = {
  id: string;
  startedAt: Date;
  resolvedAt: Date | null;
  durationSeconds: number;
  cause: string;
  monitor: { id: string; name: string };
};

export async function getIncidents(
  userId: string,
  filters: IncidentFilters = {},
) {
  const statusFilter =
    filters.status === "open"
      ? db`AND i.resolved_at IS NULL`
      : filters.status === "resolved"
        ? db`AND i.resolved_at IS NOT NULL`
        : db``;

  return db<Incident[]>`
    SELECT i.id, i.started_at AS "startedAt", i.resolved_at AS "resolvedAt",
      floor(extract(epoch FROM (COALESCE(i.resolved_at, now()) - i.started_at)))::double precision AS "durationSeconds",
      i.cause, json_build_object('id', m.id, 'name', m.name) AS monitor
    FROM incidents i
    JOIN monitors m ON m.id = i.monitor_id
    WHERE m.user_id = ${userId}
      ${statusFilter}
    ORDER BY i.started_at DESC, i.id DESC
    LIMIT ${filters.limit ?? 100}
  `;
}
