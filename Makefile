-include .env
export

.PHONY: help install dev dev-api dev-web build db-up db-down db-shell migrate migrate-new migrate-down migrate-status

help:
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install:
	npm --prefix api install
	npm --prefix web install

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api: db-up
	npm --prefix api run dev

dev-web:
	npm --prefix web run dev

build:
	npm --prefix api run build
	NODE_ENV=production npm --prefix web run build

db-up:
	docker compose up -d --wait postgres

db-down:
	docker compose down

db-shell:
	docker compose exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

migrate:
	docker compose run --rm migrate up

migrate-new:
	@test -n "$(name)" || (echo 'usage: make migrate-new name=create_users' && exit 1)
	docker compose run --rm migrate new $(name)

migrate-down:
	docker compose run --rm migrate rollback

migrate-status:
	docker compose run --rm migrate status
