package worker

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func connectDB(ctx context.Context) (*pgxpool.Pool, error) {
	for _, name := range []string{
		"POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
	} {
		if os.Getenv(name) == "" {
			return nil, fmt.Errorf("%s is not set; run make dev-worker with a configured .env", name)
		}
	}

	// Use the same local PostgreSQL settings as the API and migrations.
	databaseURL := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_PASSWORD")),
		Host:     net.JoinHostPort(os.Getenv("POSTGRES_HOST"), os.Getenv("POSTGRES_PORT")),
		Path:     os.Getenv("POSTGRES_DB"),
		RawQuery: "sslmode=disable&connect_timeout=5",
	}

	pool, err := pgxpool.New(ctx, databaseURL.String())
	if err != nil {
		// Do not include the connection URL, which contains the password.
		return nil, fmt.Errorf("invalid PostgreSQL connection settings; check POSTGRES_* variables")
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}

	return pool, nil
}
