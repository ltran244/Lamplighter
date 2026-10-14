import { db } from "../db.js";

export async function upsertGithubUser(githubId: number, username: string) {
  const [user] = await db<{ id: string }[]>`
    INSERT INTO users (github_id, username)
    VALUES (${githubId}, ${username})
    ON CONFLICT (github_id) DO UPDATE SET username = EXCLUDED.username
    RETURNING id
  `;
  return user;
}
