# Backend end-to-end tests

From the repository root:

```sh
make test-e2e
```

Or run `npm --prefix e2e test` directly. Install the API dependencies first with
`npm --prefix api install`; this suite reuses its installed Vitest and
TypeScript. No separate dependency installation is needed in this folder.

The runner starts PostgreSQL if needed, applies test migrations,
builds a separate `worker/bin/worker-e2e` binary, and runs only the backend E2E suite.
Allow roughly 40 seconds because
it exercises the worker's real scheduling and five-second idle polling.

The suite starts a real Fastify HTTP server and a local target server on random
ports, plus the Go worker as a child process. It seeds a user/session for HTTP
authentication. API calls go over HTTP; no GitHub account is needed.

The two flows cover:

1. Create a monitor, observe a successful check, pause, resume, and delete it.
2. Return HTTP 503 until three failed checks open one incident, then return 200
   and verify recovery resolves the same incident.

The test advances `next_run_at` in test data between checks rather than waiting
through full monitor intervals. It still uses the actual API, worker, HTTP
checks, and PostgreSQL transactions. These timings are not benchmark results.

Production API/worker source files are used as-is. The temporary API runs inside
Vitest; the worker runs in its own process. Cleanup stops these servers/processes
and deletes test users and their related data. No alert recipients are created.

The suite uses `POSTGRES_TEST_DB`, with the same development/test database guard
as the API tests. Regular development services can stay running on their normal
database and ports. Run `test-api`, `test-worker`, and `test-e2e` separately
because all three suites share and clean the test database.

Normal API tests use `api/vitest.config.ts`; this suite uses
`e2e/vitest.config.ts`, sharing its test environment and database guard.
Neither test command includes the other suite.

The root `e2e/` folder sits alongside `api/` and `worker/` and is not gitignored.
Its `.e2e.ts` filename keeps it out of normal API test discovery. Runner
commands live in `e2e/package.json`. Run `npm --prefix e2e run typecheck` for
TypeScript validation without executing tests.

## Measurements

Run a baseline with real worker scheduling:

```sh
make benchmark
```

Defaults are 10 monitors, one worker, 60-second intervals, a 60-second warm-up,
and a 300-second measurement window. An isolated outage-detection phase follows.
Allow about nine minutes for the full default run. It measures three naturally
scheduled failures after a healthy check, so detection includes waiting through
the configured intervals.

Run the same workload with more monitors to compare:

```sh
make benchmark BENCH_MONITORS=50
make benchmark BENCH_MONITORS=100
```

Available settings:

| Variable                 | Default  | Meaning                                       |
| ------------------------ | -------- | --------------------------------------------- |
| `BENCH_MONITORS`         | 10       | Number of monitors created through the API    |
| `BENCH_SECONDS`          | 300      | Measured workload duration, excluding warm-up |
| `BENCH_WARMUP_SECONDS`   | 60       | Warm-up before collecting samples             |
| `BENCH_INTERVAL_SECONDS` | 60       | Monitor interval; minimum 30 seconds          |
| `BENCH_LABEL`            | baseline | Label included in report filenames            |

The benchmark uses the same test database and temporary API/target/worker as
the E2E tests. It never rewrites `next_run_at` or seeds synthetic check results.
All monitors are initially due on creation and then follow the real schedule.
Run it separately from all other database suites and keep the machine awake.

It writes timestamped JSON summaries and raw check CSV files to `e2e/results/`:

- **Checks/minute:** persisted checks finished inside the measured window,
  divided by the actual elapsed minutes. Warm-up and detection samples are
  excluded. The report also records requested load, sample count, and how many
  distinct monitors were checked.
- **p50/p99 scheduling delay:** PostgreSQL percentiles of
  `actual_start - scheduled_at`, in milliseconds, for that same sample cohort.
- **Outage detection:** after the load phase, pause those monitors through the
  API and create one healthy probe. Switch its target to HTTP 503, then measure
  the time until its incident opens. This is an isolated one-monitor measurement,
  not detection under the earlier load, and does not measure SMTP delivery.

The JSON records the workload, time window, machine/CPU/RAM, Node/Go versions,
Git revision, and whether the working tree had changes. The CSV contains the
individual check timestamps, status, latency, worker ID, and scheduling delay.
Results are saved before test-data cleanup; throughput data survives a detection
timeout. Compare runs with the same settings and environment, and retain sample
counts alongside percentile values.

A short setup check can be run with:

```sh
make benchmark BENCH_MONITORS=1 BENCH_SECONDS=40 BENCH_WARMUP_SECONDS=0 BENCH_INTERVAL_SECONDS=30 BENCH_LABEL=smoke
```

The short run verifies report generation; use longer runs for resume numbers.
Benchmarks have their own Vitest config and are not included in `make test-e2e`
or the API/Go test suites.
