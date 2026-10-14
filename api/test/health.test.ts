import { afterAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

test("GET /health reports the database as up", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ db: "up" });
});
