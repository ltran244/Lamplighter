import { fileURLToPath } from "node:url";
import apiConfig from "../api/vitest.config.js";

export default {
  ...apiConfig,
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    ...apiConfig.test,
    include: ["e2e/*.e2e.ts"],
    testTimeout: 45_000,
    hookTimeout: 10_000,
  },
};
