package worker_test

import (
	"context"
	"net"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"lamplighter/worker"
)

func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, name := range []string{"POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"} {
		if os.Getenv(name) == "" {
			t.Fatalf("%s is not set; run make test-worker from the repository root", name)
		}
	}
	testDatabase := os.Getenv("POSTGRES_TEST_DB")
	if testDatabase == "" {
		testDatabase = "lamplighter_test"
	}
	if testDatabase == os.Getenv("POSTGRES_DB") {
		t.Fatal("POSTGRES_TEST_DB must be different from POSTGRES_DB")
	}
	databaseURL := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_PASSWORD")),
		Host:     net.JoinHostPort(os.Getenv("POSTGRES_HOST"), os.Getenv("POSTGRES_PORT")),
		Path:     testDatabase,
		RawQuery: "sslmode=disable&connect_timeout=5",
	}
	db, err := pgxpool.New(t.Context(), databaseURL.String())
	if err != nil {
		t.Fatalf("create test database pool: %v", err)
	}
	t.Cleanup(db.Close)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	var connectedDatabase string
	if err := db.QueryRow(ctx, "SELECT current_database()").Scan(&connectedDatabase); err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	if connectedDatabase != testDatabase {
		t.Fatal("refusing to clean a database other than POSTGRES_TEST_DB")
	}
	if _, err := db.Exec(ctx, "DELETE FROM users"); err != nil {
		t.Fatalf("clean test database: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := db.Exec(ctx, "DELETE FROM users"); err != nil {
			t.Errorf("clean test database: %v", err)
		}
	})
	return db
}

func createMonitor(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	var userID, monitorID string
	if err := db.QueryRow(t.Context(), `
		INSERT INTO users (github_id, username) VALUES (123, 'worker-test-user')
		RETURNING id::text
	`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(t.Context(), `
		INSERT INTO monitors (user_id, name, url)
		VALUES ($1, 'Test service', 'https://example.com/health')
		RETURNING id::text
	`, userID).Scan(&monitorID); err != nil {
		t.Fatal(err)
	}
	return monitorID
}

func execSQL(t *testing.T, db *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(t.Context(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func successfulResult() worker.CheckResult {
	now := time.Now()
	status := 200
	return worker.CheckResult{
		StartedAt: now, FinishedAt: now.Add(time.Millisecond),
		StatusCode: &status, LatencyMS: 1, OK: true,
	}
}

func saveCheck(t *testing.T, db *pgxpool.Pool, monitorID string, ok bool) string {
	t.Helper()
	// Make the next scheduled slot due without waiting for the polling interval.
	execSQL(t, db, "UPDATE monitors SET next_run_at = now() - interval '1 second' WHERE id = $1", monitorID)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil || monitor == nil {
		t.Fatalf("claim monitor before saving: monitor=%v error=%v", monitor, err)
	}
	result := successfulResult()
	if !ok {
		status := 503
		result.OK = false
		result.StatusCode = &status
		result.Error = "expected HTTP 200, received HTTP 503"
	}
	saved, alert, err := worker.SaveResult(t.Context(), db, monitor, result, "test-worker")
	if err != nil || !saved {
		t.Fatalf("save check: saved=%v error=%v", saved, err)
	}
	return alert
}
