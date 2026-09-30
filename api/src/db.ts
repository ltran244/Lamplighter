import postgres from "postgres";
import { config } from "./config.js";

export const db = postgres({
  host: config.db.host,
  port: config.db.port,
  username: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connect_timeout: 5,
});
