# Résa — Reservation service

Microservice owning the **reservation domain**: bookings, hold-slots and availability
(blocked periods). The public API contract lives in the gateway repo
(`../backend/docs/openapi.yaml`) — routes are exposed through the gateway, which
authenticates managers and forwards requests here with the `X-Manager-Id` header.

**This service must never be exposed publicly**: it trusts `X-Manager-Id`.
Bind it to localhost or an internal docker network only.

## Stack

Bun + Express 5 + Prisma 7 (PostgreSQL) + Zod 4 — same conventions as the gateway.

## Database

Shares the gateway's Postgres. The gateway owns `prisma/migrations`; this repo keeps a
copy of `schema.prisma` for client generation only:

```sh
bun install
bunx prisma generate
```

## Run

```sh
bun run dev          # listens on PORT (default 3001)
bun test
```
