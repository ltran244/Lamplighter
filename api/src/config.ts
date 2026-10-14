function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set (run through make, or copy .env.example to .env)`,
    );
  }
  return value;
}

function int(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback === undefined) throw new Error(`${name} is not set`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "production",
  port: int("PORT", 3000),
  db: {
    host: required("POSTGRES_HOST"),
    port: int("POSTGRES_PORT"),
    user: required("POSTGRES_USER"),
    password: required("POSTGRES_PASSWORD"),
    database: required("POSTGRES_DB"),
  },
  github: {
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    redirectUri: required("GITHUB_REDIRECT_URI"),
  },
} as const;
