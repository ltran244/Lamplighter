package worker_test

import (
	"testing"
	"time"

	"lamplighter/worker"
)

func TestNextRunAt(t *testing.T) {
	scheduled := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	got := worker.NextRunAt(scheduled, scheduled.Add(15*time.Second), 60)
	want := scheduled.Add(time.Minute)
	if !got.Equal(want) {
		t.Fatalf("next run = %s, want %s", got, want)
	}
}

func TestNextRunAtSkipsMissedIntervals(t *testing.T) {
	scheduled := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	got := worker.NextRunAt(scheduled, scheduled.Add(150*time.Second), 60)
	want := scheduled.Add(3 * time.Minute)
	if !got.Equal(want) {
		t.Fatalf("next run = %s, want %s", got, want)
	}
}
