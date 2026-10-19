package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"lamplighter/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := worker.Run(ctx); err != nil {
		log.Printf("worker failed: %v", err)
		os.Exit(1)
	}
}
