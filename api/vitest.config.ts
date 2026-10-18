import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

const testDatabase = process.env.POSTGRES_TEST_DB ?? "lamplighter_test";
if (
  !process.env.POSTGRES_DB ||
  !testDatabase ||
  testDatabase === process.env.POSTGRES_DB
) {
  throw new Error("POSTGRES_TEST_DB must be different from POSTGRES_DB");
}

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: ["src/index.ts"],
    },
    env: {
      NODE_ENV: "test",
      POSTGRES_DB: testDatabase,
      GITHUB_CLIENT_ID: "test-client",
      GITHUB_CLIENT_SECRET: "test-secret",
      GITHUB_REDIRECT_URI: "http://localhost:3000/auth/github/callback",
      FRONTEND_URL: "http://localhost:5173",
    },

  },
});
