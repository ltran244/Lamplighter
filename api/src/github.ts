import { GitHub } from "arctic";
import { config } from "./config.js";

export const github = new GitHub(
  config.github.clientId,
  config.github.clientSecret,
  config.github.redirectUri,
);
