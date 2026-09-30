import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

try {
  // 0.0.0.0 so the server is reachable from outside its Docker container later
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
