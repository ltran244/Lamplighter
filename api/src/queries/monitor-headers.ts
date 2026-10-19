import { db } from "../db.js";
import { decryptHeaderValue, encryptHeaderValue } from "../header-secrets.js";

export type MonitorHeaderInput = {
  name: string;
  value?: string;
  isSecret: boolean;
};

type StoredHeader = {
  name: string;
  valueEncrypted: Buffer;
  isSecret: boolean;
};

function publicHeader(header: StoredHeader) {
  return {
    name: header.name,
    value: header.isSecret
      ? "••••••"
      : decryptHeaderValue(header.valueEncrypted),
    isSecret: header.isSecret,
  };
}

export async function getMonitorHeaders(userId: string, monitorId: string) {
  const headers = await db<StoredHeader[]>`
    SELECT h.name, h.value_encrypted AS "valueEncrypted", h.is_secret AS "isSecret"
    FROM monitor_headers h
    JOIN monitors m ON m.id = h.monitor_id
    WHERE m.id = ${monitorId} AND m.user_id = ${userId}
    ORDER BY lower(h.name)
  `;
  return headers.map(publicHeader);
}

export async function replaceMonitorHeaders(
  userId: string,
  monitorId: string,
  input: MonitorHeaderInput[],
) {
  return db.begin(async (tx) => {
    // Serialize replacements so omitted secret values come from the current set.
    const [monitor] = await tx`
      SELECT id FROM monitors
      WHERE id = ${monitorId} AND user_id = ${userId}
      FOR UPDATE
    `;
    if (!monitor) return undefined;

    const existing = await tx<StoredHeader[]>`
      SELECT name, value_encrypted AS "valueEncrypted", is_secret AS "isSecret"
      FROM monitor_headers WHERE monitor_id = ${monitorId}
    `;
    const byName = new Map(
      existing.map((header) => [header.name.toLowerCase(), header]),
    );
    const headers = input.map((header): StoredHeader => {
      const previous = byName.get(header.name.toLowerCase());
      if (
        header.value === undefined &&
        !(previous?.isSecret && header.isSecret)
      ) {
        throw Object.assign(
          new Error("Provide a value for new headers and non-secret headers."),
          { statusCode: 400 },
        );
      }
      return {
        name: header.name,
        valueEncrypted:
          header.value === undefined
            ? previous!.valueEncrypted
            : encryptHeaderValue(header.value),
        isSecret: header.isSecret,
      };
    });

    // Build the masked response before writing, so decryption failures roll back.
    const response = headers.map(publicHeader);
    await tx`DELETE FROM monitor_headers WHERE monitor_id = ${monitorId}`;
    if (headers.length > 0) {
      const rows = headers.map((header) => ({
        monitor_id: monitorId,
        name: header.name,
        value_encrypted: header.valueEncrypted,
        is_secret: header.isSecret,
      }));
      await tx`
        INSERT INTO monitor_headers
        ${tx(rows, "monitor_id", "name", "value_encrypted", "is_secret")}
      `;
    }
    return response.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  });
}
