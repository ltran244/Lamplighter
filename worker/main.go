package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx); err != nil {
		log.Printf("worker failed: %v", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	db, err := connectDB(ctx)
	if err != nil {
		return err
	}
	defer db.Close()

	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("get worker hostname: %w", err)
	}
	workerID := fmt.Sprintf("%s-%d", hostname, os.Getpid())

	client := &http.Client{
		// Check the target's own status, including any redirect response.
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	defer client.CloseIdleConnections()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	log.Printf("worker %s started; connected to PostgreSQL", workerID)
	defer log.Println("worker stopped")

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			claimCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			monitor, err := claimMonitor(claimCtx, db)
			cancel()
			if err != nil {
				if ctx.Err() != nil {
					continue
				}
				log.Printf("claim monitor: %v", err)
				continue
			}
			if monitor == nil {
				continue
			}

			log.Printf("claimed monitor %s; lease expires at %s", monitor.ID, monitor.LeaseUntil.Format(time.RFC3339))
			result := checkMonitor(ctx, client, monitor)
			if ctx.Err() != nil {
				return nil
			}

			saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			saved, err := saveResult(saveCtx, db, monitor, result, workerID)
			cancel()
			if err != nil {
				if ctx.Err() != nil {
					return nil
				}
				log.Printf("save result for monitor %s: %v", monitor.ID, err)
				continue
			}
			if !saved {
				log.Printf("discarded result for monitor %s: monitor gone or lease no longer valid", monitor.ID)
				continue
			}

			if result.OK {
				log.Printf("monitor %s: status=%d latency_ms=%d ok=true", monitor.ID, *result.StatusCode, result.LatencyMS)
			} else {
				log.Printf("monitor %s: latency_ms=%d ok=false error=%q", monitor.ID, result.LatencyMS, result.Error)
			}
		}
	}
}
