-include .env
export

.PHONY: help install dev dev-api dev-web build test-api test-api-coverage db-up db-down db-shell check-test-db migrate migrate-test migrate-new migrate-down migrate-status

help:
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install:
	npm --prefix api install
	npm --prefix web install

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	npm --prefix api run dev

dev-web:
	npm --prefix web run dev

build:
	npm --prefix api run build
	npm --prefix web run build

test-api:
	npm --prefix api run test

test-api-coverage:
	npm --prefix api run test:coverage

db-up:
	npm --prefix api run db:up

db-down:
	npm --prefix api run db:down

db-shell:
	npm --prefix api run db:shell

check-test-db:
	npm --prefix api run db:check-test

migrate:
	npm --prefix api run migrate

migrate-test:
	npm --prefix api run migrate:test

migrate-new:
	npm --prefix api run migrate:new -- $(name)

migrate-down:
	npm --prefix api run migrate:down

migrate-status:
	npm --prefix api run migrate:status
