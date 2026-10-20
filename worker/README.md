# Worker

Configure the root `.env` using `.env.example`, then run from the repository root:

```sh
make migrate
make dev-worker
```

Make exports the existing `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, and `POSTGRES_DB` settings. The worker connects with pgx,
pings PostgreSQL on startup, and closes the pool on Ctrl+C or SIGTERM.

The worker immediately claims a monitor that is unpaused, due
(`next_run_at <= now()`), and has no active lease. One atomic SQL statement uses
`FOR UPDATE SKIP LOCKED` and sets a 60-second lease using PostgreSQL's clock.
After processing a result and any alert, it immediately tries to claim the next
due monitor. It waits five seconds only when no monitor is eligible or a claim
fails, avoiding a busy loop while idle or PostgreSQL is unavailable. Shutdown
interrupts that wait. Checks still run one at a time.

After claiming a monitor, the worker checks its URL using the configured GET
or HEAD method and `timeout_ms`. It compares the HTTP response status with
`expected_status` and logs success or failure and elapsed milliseconds.
Network failures and timeouts produce failed results without an HTTP status.
Shutdown also cancels an in-flight request.

Redirects are not followed: the target's redirect status is compared directly
with `expected_status`. The response body is closed without downloading its
contents; this check only evaluates HTTP status. Checks currently run one at a
time.

Each completed check is saved in one database transaction:

1. Lock the monitor and verify that its lease still matches and has not expired.
2. Insert a `check_runs` row with scheduled/start/finish times, HTTP status (null
   for network failures), latency, success, error, and the worker's hostname/PID.
3. Update consecutive failures and status. Three failures in a row mark it down;
   a successful check resets failures and marks it up. Failures below the
   threshold preserve its previous status, including `unknown` for new monitors.
4. Open an incident on a transition to down, or resolve the open incident on
   recovery. Continued failures do not create additional incidents.
5. Set the next check time and clear the lease.

The next check stays on the original interval grid. Missed slots are skipped
until the next slot after the database's current time. The current monitor
interval is read when saving, so changes to the interval take effect then.

Deleted monitors and stale or expired claims are discarded without writes.
Database failures roll back the whole transaction and leave the lease to expire
for retry. Checks cancelled by worker shutdown are not recorded as failures.
An interrupted worker's lease also expires naturally so another worker can
recover the monitor.

HTTP checks and email delivery run outside database transactions. Concurrent
checks remain future work.

## Tests

The 13 basic tests live in `worker/test/`. They cover HTTP success/status
mismatch/timeout, next-run scheduling, monitor claims, saving results, incident
opening/recovery, and stale claims. They call worker functions directly; the
polling process and real email delivery are not started.

Run from the repository root:

```sh
make test-worker
```

Make loads the root `.env`, starts PostgreSQL and applies the test migrations
through the existing API package script, then runs `go -C worker test -count=1 ./test`.
Database tests use `POSTGRES_TEST_DB` (default `lamplighter_test`) and refuse to
run if it matches `POSTGRES_DB`. They delete test users and related data before
and after each database test. Run these separately from the API tests because
both suites use the same test database.

HTTP and scheduling tests can run without PostgreSQL or `.env`:

```sh
go -C worker test -count=1 ./test -run 'TestCheckMonitor|TestNextRunAt'
```

The worker code is an importable Go package so the separate test folder can
call it. The executable entry point is `cmd/worker/main.go`; `make dev-worker`
and `make build-worker` use that entry point.

Run `make test-e2e` for the API + worker flows in the root
[`e2e/` folder](../e2e/README.md). Run database suites separately because they
share and clean the test database.

## Email alerts

Set `EMAIL` and `EMAIL_PASSWORD` in the root `.env` to your Ethereal account
credentials. The worker uses `smtp.ethereal.email:587` with required STARTTLS;
`EMAIL` is also the sender address. View captured messages in Ethereal.

After a result commits, the worker sends an email to each distinct
`alert_channels.target` belonging to the monitor's owner when it enters down
or recovers. Continued failures do not send more emails. A user needs an email
channel row; the worker does not automatically use their GitHub email address.
Manage recipients through `/api/alert-channels` in the API.

The database must have the revised email-only alert table (`type = 'email'`,
`target`). Editing an already-applied migration does not update existing
databases, and running `make migrate` does not rerun it.

Email failures are logged and monitoring continues. Each recipient has a
10-second send timeout. There are no retries or delivery queue yet, so a failed
send or a worker crash after commit can lose an alert.

Build a binary with `make build-worker`. Running `./worker/bin/worker` directly
requires the same environment variables to be exported first. Connections use
SSL disabled for the current local Docker setup, matching the migration service.

References: [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool),
[PostgreSQL row locking](https://www.postgresql.org/docs/18/sql-select.html),
[go-mail](https://pkg.go.dev/github.com/wneessen/go-mail),
[Ethereal SMTP settings](https://ethereal.email/help).
