import { upsertGithubUser } from "../src/queries/auth.js";
import { createSession } from "../src/queries/sessions.js";
import { SESSION_COOKIE } from "../src/session.js";

export async function createUserSession(githubId = 123) {
  const user = await upsertGithubUser(githubId, `test-user-${githubId}`);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const session = await createSession(user.id, expiresAt);

  return {
    userId: user.id,
    cookies: { [SESSION_COOKIE]: session.id },
  };
}
