package worker

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

func Run(ctx context.Context) error {
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

	log.Printf("worker %s started; connected to PostgreSQL", workerID)
	defer log.Println("worker stopped")

	for {
		if ctx.Err() != nil {
			return nil
		}
		claimCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		monitor, err := ClaimMonitor(claimCtx, db)
		cancel()
		if err != nil || monitor == nil {
			if ctx.Err() != nil {
				return nil
			}
			if err != nil {
				log.Printf("claim monitor: %v", err)
			}
			// Wait only when idle or after a claim error; due work is drained immediately.
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(5 * time.Second):
			}
			continue
		}

		log.Printf("claimed monitor %s; lease expires at %s", monitor.ID, monitor.LeaseUntil.Format(time.RFC3339))
		result := CheckMonitor(ctx, client, monitor)
		if ctx.Err() != nil {
			return nil
		}

		saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		saved, alert, err := SaveResult(saveCtx, db, monitor, result, workerID)
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
		// Send alert if needed
		if alert != "" {
			targetCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			targets, err := getAlertTargets(targetCtx, db, monitor.ID)
			cancel()
			if err != nil {
				log.Printf("get email targets for monitor %s: %v", monitor.ID, err)
				continue
			}
			if len(targets) == 0 {
				continue
			}
			if err := sendMonitorAlerts(ctx, targets, monitor, result, alert); err != nil {
				log.Printf("send %s email for monitor %s: %v", alert, monitor.ID, err)
			} else {
				log.Printf("sent %s email for monitor %s", alert, monitor.ID)
			}
		}
	}
}
