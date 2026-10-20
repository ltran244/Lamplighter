import config from "./vitest.config.js";
import { benchmarkTimeoutMs } from "./benchmark-settings.js";

export default {
  ...config,
  test: {
    ...config.test,
    include: ["e2e/*.benchmark.ts"],
    disableConsoleIntercept: true,
    testTimeout: benchmarkTimeoutMs,
  },
};
