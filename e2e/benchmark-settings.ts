function integer(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return value;
}

export const workload = {
  monitors: integer("BENCH_MONITORS", 10),
  seconds: integer("BENCH_SECONDS", 300),
  warmupSeconds: integer("BENCH_WARMUP_SECONDS", 60, 0),
  intervalSeconds: integer("BENCH_INTERVAL_SECONDS", 60, 30),
  workers: 1,
  label: process.env.BENCH_LABEL ?? "baseline",
};

export const detectionTimeoutSeconds = workload.intervalSeconds * 3 + 30;
export const benchmarkTimeoutMs =
  (workload.warmupSeconds + workload.seconds + detectionTimeoutSeconds + 120) *
  1000;
