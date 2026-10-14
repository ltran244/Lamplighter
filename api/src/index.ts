import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, "server shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  // 0.0.0.0 so the server is reachable from outside its Docker container later
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
