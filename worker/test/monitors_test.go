package worker_test

import (
	"testing"
	"time"

	"lamplighter/worker"
)

func TestClaimDueMonitor(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	if monitor == nil || monitor.ID != id || !monitor.LeaseUntil.After(time.Now()) {
		t.Fatalf("expected the due monitor with an active lease, got %+v", monitor)
	}
}

func TestClaimSkipsPausedMonitor(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	execSQL(t, db, "UPDATE monitors SET paused = true WHERE id = $1", id)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil || monitor != nil {
		t.Fatalf("expected no paused monitor to be claimed: monitor=%v error=%v", monitor, err)
	}
}

func TestClaimSkipsFutureMonitor(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	execSQL(t, db, "UPDATE monitors SET next_run_at = now() + interval '1 hour' WHERE id = $1", id)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil || monitor != nil {
		t.Fatalf("expected no future monitor to be claimed: monitor=%v error=%v", monitor, err)
	}
}

func TestClaimSkipsLeasedMonitor(t *testing.T) {
	db := testDB(t)
	id := createMonitor(t, db)
	execSQL(t, db, "UPDATE monitors SET lease_until = now() + interval '1 hour' WHERE id = $1", id)
	monitor, err := worker.ClaimMonitor(t.Context(), db)
	if err != nil || monitor != nil {
		t.Fatalf("expected no leased monitor to be claimed: monitor=%v error=%v", monitor, err)
	}
}
