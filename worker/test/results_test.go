package worker_test

import (
	"testing"

	"lamplighter/worker"
)

func TestSaveCheckResult(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	if alert := saveCheck(t, db, id, true); alert != "" {
		t.Fatalf("initial success should not alert, got %q", alert)
	}
	var status string
	var failures int
	var ok, leaseCleared, scheduled bool
	err := db.QueryRow(t.Context(), `
		SELECT m.status, m.consecutive_failures, m.lease_until IS NULL,
			m.next_run_at > c.scheduled_at, c.ok
		FROM monitors m JOIN check_runs c ON c.monitor_id = m.id
		WHERE m.id = $1
	`, id).Scan(&status, &failures, &leaseCleared, &scheduled, &ok)
	if err != nil {
		t.Fatal(err)
	}
	if status != "up" || failures != 0 || !leaseCleared || !scheduled || !ok {
		t.Fatalf("unexpected saved result: status=%s failures=%d leaseCleared=%v scheduled=%v ok=%v",
			status, failures, leaseCleared, scheduled, ok)
	}
}

func TestFailuresOpenOneIncident(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	for failure := 1; failure <= 4; failure++ {
		alert := saveCheck(t, db, id, false)
		want := ""
		if failure == 3 {
			want = "down"
		}
		if alert != want {
			t.Fatalf("failure %d: alert=%q, want %q", failure, alert, want)
		}
	}
	var status string
	var failures, incidents int
	if err := db.QueryRow(t.Context(), `
		SELECT status, consecutive_failures,
			(SELECT count(*) FROM incidents WHERE monitor_id = $1)
		FROM monitors WHERE id = $1
	`, id).Scan(&status, &failures, &incidents); err != nil {
		t.Fatal(err)
	}
	if status != "down" || failures != 4 || incidents != 1 {
		t.Fatalf("expected down, four failures, and one incident; got %s, %d, %d", status, failures, incidents)
	}
}

func TestRecoveryResolvesIncident(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	execSQL(t, db, "UPDATE monitors SET status = 'down', consecutive_failures = 3 WHERE id = $1", id)
	execSQL(t, db, "INSERT INTO incidents (monitor_id, cause) VALUES ($1, 'Test outage')", id)
	if alert := saveCheck(t, db, id, true); alert != "recovered" {
		t.Fatalf("expected recovered alert, got %q", alert)
	}
	var status string
	var failures int
	var resolved bool
	if err := db.QueryRow(t.Context(), `
		SELECT m.status, m.consecutive_failures, i.resolved_at IS NOT NULL
		FROM monitors m JOIN incidents i ON i.monitor_id = m.id
		WHERE m.id = $1
	`, id).Scan(&status, &failures, &resolved); err != nil {
		t.Fatal(err)
	}
	if status != "up" || failures != 0 || !resolved {
		t.Fatalf("expected recovered monitor and resolved incident; got %s, %d, %v", status, failures, resolved)
	}
}

func TestSaveIgnoresStaleClaim(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil || monitor == nil {
		t.Fatalf("claim monitor: monitor=%v error=%v", monitor, err)
	}
	execSQL(t, db, "UPDATE monitors SET lease_until = now() - interval '1 second' WHERE id = $1", id)
	saved, alert, err := worker.SaveResult(t.Context(), db, monitor, successfulResult(), "test-worker")
	if err != nil || saved || alert != "" {
		t.Fatalf("expected stale result to be discarded: saved=%v alert=%q error=%v", saved, alert, err)
	}
	var count int
	if err := db.QueryRow(t.Context(), "SELECT count(*) FROM check_runs WHERE monitor_id = $1", id).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected no saved checks, got %d", count)
	}
}
