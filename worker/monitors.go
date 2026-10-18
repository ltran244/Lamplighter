package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Monitor struct {
	ID              string
	Name            string
	URL             string
	Method          string
	IntervalSeconds int
	TimeoutMS       int
	ExpectedStatus  int
	ScheduledAt     time.Time
	LeaseUntil      time.Time
}

func claimMonitor(ctx context.Context, db *pgxpool.Pool) (*Monitor, error) {
	var monitor Monitor

	// Claim and lease in one statement. Other workers skip the locked row.
	err := db.QueryRow(ctx, `
		UPDATE monitors
		SET lease_until = now() + interval '60 seconds'
		WHERE id = (
			SELECT id
			FROM monitors
			WHERE NOT paused
				AND next_run_at <= now()
				AND (lease_until IS NULL OR lease_until <= now())
			ORDER BY next_run_at, id
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id::text, name, url, method, interval_seconds, timeout_ms,
			expected_status, next_run_at, lease_until
	`).Scan(
		// Scan the returned row into the monitor struct
		&monitor.ID, &monitor.Name, &monitor.URL, &monitor.Method,
		&monitor.IntervalSeconds, &monitor.TimeoutMS, &monitor.ExpectedStatus,
		&monitor.ScheduledAt, &monitor.LeaseUntil,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &monitor, nil
}
