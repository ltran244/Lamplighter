package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type CheckResult struct {
	StartedAt  time.Time
	FinishedAt time.Time
	StatusCode *int
	LatencyMS  int64
	OK         bool
	Error      string
}

func checkMonitor(ctx context.Context, client *http.Client, monitor *Monitor) (result CheckResult) {
	// Start the check timer
	result.StartedAt = time.Now()
	defer func() {
		result.FinishedAt = time.Now()
		result.LatencyMS = result.FinishedAt.Sub(result.StartedAt).Milliseconds()
	}()

	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(monitor.TimeoutMS)*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(checkCtx, monitor.Method, monitor.URL, nil)
	if err != nil {
		result.Error = err.Error()
		return
	}
	req.Header.Set("User-Agent", "Lamplighter")
	// Perform the HTTP request
	response, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		return
	}
	defer response.Body.Close()

	result.StatusCode = &response.StatusCode
	result.OK = response.StatusCode == monitor.ExpectedStatus
	if !result.OK {
		result.Error = fmt.Sprintf("expected HTTP %d, received HTTP %d", monitor.ExpectedStatus, response.StatusCode)
	}

	return
}
