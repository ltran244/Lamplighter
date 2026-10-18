package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const failureThreshold = 3

// A false result means the monitor was deleted or this claim is no longer valid.
func saveResult(ctx context.Context, db *pgxpool.Pool, monitor *Monitor, result CheckResult, workerID string) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin result transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var previousStatus string
	var failures, intervalSeconds int
	var now time.Time

	// Lock the monitor row and check the lease so we only update if we still own it
	err = tx.QueryRow(ctx, `
		SELECT status, consecutive_failures, interval_seconds, now()
		FROM monitors
		WHERE id = $1 AND lease_until = $2 AND lease_until > now()
		FOR UPDATE
	`, monitor.ID, monitor.LeaseUntil).Scan(&previousStatus, &failures, &intervalSeconds, &now)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("verify monitor lease: %w", err)
	}

	status := previousStatus
	if result.OK {
		failures = 0
		status = "up"
	} else {
		failures++
		if failures >= failureThreshold {
			status = "down"
		}
	}
	// Update the monitor status and failures based on the check result
	_, err = tx.Exec(ctx, `
		INSERT INTO check_runs (
			monitor_id, scheduled_at, actual_start, finished_at,
			status_code, latency_ms, ok, error, worker_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9)
	`, monitor.ID, monitor.ScheduledAt, result.StartedAt, result.FinishedAt,
		result.StatusCode, result.LatencyMS, result.OK, result.Error, workerID)
	if err != nil {
		return false, fmt.Errorf("insert check result: %w", err)
	}
	// Open an incident if the monitor just went down, or resolve if it came back up
	if status == "down" && previousStatus != "down" {
		_, err = tx.Exec(ctx, `
			INSERT INTO incidents (monitor_id, cause)
			VALUES ($1, $2)
		`, monitor.ID, result.Error)
		if err != nil {
			return false, fmt.Errorf("open incident: %w", err)
		}
	} else if status == "up" && previousStatus == "down" {
		_, err = tx.Exec(ctx, `
			UPDATE incidents SET resolved_at = now()
			WHERE monitor_id = $1 AND resolved_at IS NULL
		`, monitor.ID)
		if err != nil {
			return false, fmt.Errorf("resolve incident: %w", err)
		}
	}
	// Update the monitor schedule and clear the lease
	_, err = tx.Exec(ctx, `
		UPDATE monitors
		SET status = $3, consecutive_failures = $4,
			next_run_at = $5, lease_until = NULL
		WHERE id = $1 AND lease_until = $2
	`, monitor.ID, monitor.LeaseUntil, status, failures,
		nextRunAt(monitor.ScheduledAt, now, intervalSeconds))
	if err != nil {
		return false, fmt.Errorf("update monitor schedule: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit check result: %w", err)
	}
	return true, nil
}

// Keep the original schedule and skip missed slots instead of replaying them.
func nextRunAt(scheduledAt, now time.Time, intervalSeconds int) time.Time {
	interval := time.Duration(intervalSeconds) * time.Second
	if now.Before(scheduledAt) {
		return scheduledAt.Add(interval)
	}
	slots := now.Sub(scheduledAt)/interval + 1
	return scheduledAt.Add(slots * interval)
}
