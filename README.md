# Roam Caller

Travel eSIMs for 108+ countries, sold to businesses (fintechs, airlines, travel agencies, banks,
insurers, tourism agencies) and their customers. Head office: Lagos, Nigeria.

eSIMs come from the RoamBuddy white-label partner API. Roam Caller adds partner accounts, its own
pricing in local currencies, a prepaid balance per partner, a ledger, webhooks and (next) hosted
eSIM screens that partners open inside their apps.

## What's here

```
apps/
  api/        Partner API (Fastify). Partners call it with API keys.
  worker/     Scheduled jobs (pg-boss): stuck orders, webhooks, eSIM usage, wallet alert, plan sync.
  web/        Next.js: landing page now; hosted eSIM screens and admin next.
packages/
  core/       Business logic: order engine, ledger, pricing, API keys, webhooks, jobs.
  db/         Postgres schema (Drizzle) and migrations.
  roambuddy/  RoamBuddy API client, response parsing, and a mock RoamBuddy for tests and local work.
docs/
  API.md        Partner API reference (send this to partners).
  ROAMBUDDY.md  What we assume about RoamBuddy's API and what must be confirmed.
```

## How an order works

```
Partner app ─▶ POST /v1/orders ─▶ hold the price on the partner's prepaid balance
                                 ─▶ RoamBuddy: request order ─▶ complete order (paid from our wallet)
                                 ─▶ fetch install details (ICCID, LPA code) ─▶ charge the hold
                                 ─▶ 201 with the eSIM, plus an `order.delivered` webhook
```

If RoamBuddy refuses, the hold is released and the partner gets `order.failed`. If we can't tell
whether RoamBuddy completed it (a timeout), the order waits and the worker checks again, so a
customer is never refunded for an eSIM we paid for, or charged for one we didn't get. Details:
`packages/core/src/orders.ts`.

Money rules:
- Amounts are integers in minor units (kobo, cents) with their currency.
- Every money movement is a balanced double-entry posting in `ledger_entries`. The database
  rejects unbalanced postings and any update or delete of ledger rows.
- Each posting is keyed by what it's for (e.g. the order id), so repeating a step can't post twice.
- `test` keys use the RoamBuddy sandbox and test balances; `live` keys use real money.

## Run it locally

Needs Node 22+, pnpm 10 and Postgres 16 (`docker compose up -d` starts one).

```bash
pnpm install
cp .env.example .env            # defaults point at the mock RoamBuddy
pnpm db:migrate
pnpm mock:roambuddy             # terminal 1: fake RoamBuddy on :4100
pnpm --filter @roam/worker dev  # terminal 2: syncs plans on start
pnpm --filter @roam/api dev     # terminal 3: API on :4000
pnpm --filter @roam/web dev     # optional: landing page on :3000

pnpm fx:set NGN 1550
pnpm partner:create --name "Demo Pay" --slug demo-pay --currency NGN --test-credit 5000000
```

Then, with the printed test key:

```bash
curl localhost:4000/v1/plans?country=AE -H "Authorization: Bearer rc_test_…"
curl -X POST localhost:4000/v1/orders -H "Authorization: Bearer rc_test_…" \
  -H "Idempotency-Key: demo-1" -H "Content-Type: application/json" \
  -d '{"plan_id":"<id from /v1/plans>","reference":"txn-001"}'
```

Mock plans 9001, 9002 and 9003 fail on request, fail on complete, and deliver late.

## Operations

| Task | Command |
|---|---|
| Set an exchange rate | `pnpm fx:set NGN 1550.50` |
| New partner (test and live keys) | `pnpm partner:create --name … --slug … --currency NGN [--webhook-url …]` |
| Record a partner's payment | `pnpm partner:credit --slug acme --mode live --amount 50000000 --ref "<bank ref>"` |
| Apply migrations | `pnpm db:migrate` |
| New migration after editing `packages/db/src/schema.ts` | `pnpm db:generate` |

Never edit a migration that has run anywhere real; add a new one.

## Checks

```bash
pnpm typecheck
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

Tests create and drop their own databases on that server and run against the mock RoamBuddy.

## Deploying

- **API and worker:** containers on AWS ECS Fargate (eu-west-2) behind a NAT gateway with an
  Elastic IP, because RoamBuddy may need to approve our IP address (docs/ROAMBUDDY.md).
  The RoamBuddy client must not run on Vercel serverless functions, which have no fixed IP.
- **Database:** Postgres 16 on RDS.
- **Web:** Vercel.
- **Secrets:** AWS Secrets Manager. Nothing secret goes in the repo.

## Not built yet

- Hosted eSIM screens and the payment handshake with the partner (build plan, Phase 3)
- Top-ups and post-delivery cancellations or refunds in the partner API
- Internal admin, daily reconciliation against RoamBuddy wallet transactions
- Partner portal, emails, monitoring (Sentry, Better Stack)
- Dockerfiles and infrastructure as code
