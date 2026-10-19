package worker_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lamplighter/worker"
)

func TestCheckMonitorSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	monitor := &worker.Monitor{URL: server.URL, Method: "GET", TimeoutMS: 2000, ExpectedStatus: 200}
	result := worker.CheckMonitor(t.Context(), server.Client(), monitor)
	if !result.OK || result.StatusCode == nil || *result.StatusCode != 200 || result.Error != "" {
		t.Fatalf("expected a successful HTTP 200 check, got %+v", result)
	}
}

func TestCheckMonitorWrongStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	monitor := &worker.Monitor{URL: server.URL, Method: "GET", TimeoutMS: 2000, ExpectedStatus: 200}
	result := worker.CheckMonitor(t.Context(), server.Client(), monitor)
	if result.OK || result.StatusCode == nil || *result.StatusCode != 503 || result.Error == "" {
		t.Fatalf("expected a failed HTTP 503 check, got %+v", result)
	}
}

func TestCheckMonitorTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, req *http.Request) {
		<-req.Context().Done()
	}))
	defer server.Close()

	monitor := &worker.Monitor{URL: server.URL, Method: "GET", TimeoutMS: 50, ExpectedStatus: 200}
	result := worker.CheckMonitor(t.Context(), server.Client(), monitor)
	if result.OK || result.StatusCode != nil || !strings.Contains(result.Error, context.DeadlineExceeded.Error()) {
		t.Fatalf("expected a timeout without an HTTP status, got %+v", result)
	}
}
