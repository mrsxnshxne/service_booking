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

## To test payment

### Requirements

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli).

### Setup

Add your Stripe keys to `.env`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # printed by `stripe listen` on first run
```

### Flow

1. Start the gateway (port 3000) and this service (port 3001).

2. Start the Stripe webhook forwarder — targets the **gateway**, which proxies to this service:
   ```sh
   stripe listen --forward-to localhost:3000/api/v1/payments/webhook
   ```
   Copy the `whsec_...` secret printed and paste it into `.env` as `STRIPE_WEBHOOK_SECRET`.

3. Create a payment:
   ```http
   POST /api/v1/bookings/<booking_id>/payments
   { "type": "deposit" }
   ```
   Returns `{ client_secret, ... }`.

4. Simulate a successful payment:
   ```sh
   stripe trigger payment_intent.succeeded
   ```
   The webhook updates the payment to `succeeded` and the booking to `confirmed`.
