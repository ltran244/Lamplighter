# Worker

Configure the root `.env` using `.env.example`, then run from the repository root:

```sh
make migrate
make dev-worker
```

Make exports the existing `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, and `POSTGRES_DB` settings. The worker connects with pgx,
pings PostgreSQL on startup, and closes the pool on Ctrl+C or SIGTERM.

Every five seconds it claims at most one monitor that is unpaused, due
(`next_run_at <= now()`), and has no active lease. One atomic SQL statement uses
`FOR UPDATE SKIP LOCKED` and sets a 60-second lease using PostgreSQL's clock.
No eligible monitor is a normal outcome. Claim failures are logged and retried
on the next tick.

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

HTTP checks run outside database transactions. Alert delivery and concurrent
checks remain future work.

Build a binary with `make build-worker`. Running `./worker/bin/worker` directly
requires the same environment variables to be exported first. Connections use
SSL disabled for the current local Docker setup, matching the migration service.

References: [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool),
[PostgreSQL row locking](https://www.postgresql.org/docs/18/sql-select.html).
