import { db } from "../db.js";

export type SessionUser = {
  id: string;
  username: string;
};

export async function createSession(userId: string, expiresAt: Date) {
  const [session] = await db<{ id: string }[]>`
          INSERT INTO sessions (user_id, expires_at)
          VALUES (${userId}, ${expiresAt.toISOString()})
          RETURNING id
        `;
  return session;
}
export async function getSessionUser(sessionId: string) {
  const [user] = await db<SessionUser[]>`
    SELECT users.id, users.username
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ${sessionId}
      AND sessions.expires_at > now()
  `;
  return user;
}

export async function deleteSession(sessionId: string) {
  await db`DELETE FROM sessions WHERE id = ${sessionId}`;
}
