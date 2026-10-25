# RoamBuddy partner API: assumptions and open questions

Source: https://roambuddy-partner.apidog.io/llms.txt (white-label partner API).
Servers: live `https://api.worldroambuddy.com:3001/api/v1`, sandbox `https://sandbox.worldroambuddy.com:3001/api/v1`.

The docs describe request bodies but **every response schema is empty**. Everything we read from a
response goes through `packages/roambuddy/src/extract.ts`, which accepts several likely field
names. The mock (`packages/roambuddy/src/mock.ts`) returns one guessed shape.

**After the first real sandbox order:** save the real responses, narrow `extract.ts` to the real
field names, make the mock return the real shapes, and tick the questions below.

## What the code assumes

| Topic | Assumption | Where |
|---|---|---|
| Auth header | Token sent as the raw `Authorization` value (as in the docs). `ROAMBUDDY_AUTH_SCHEME=bearer` switches to `Bearer <token>`. | `client.ts` |
| Login response | Token in `token`, `access_token` or `data.token`. | `client.ts` `findToken` |
| Token lifetime | Unknown. On a 401 we log in again once. | `client.ts` |
| Order flow | `orders/request` creates an unpaid order; `orders/complete` pays from our wallet and issues the eSIM. | `core/orders.ts` |
| Retries | POSTs are never retried automatically: RoamBuddy documents no idempotency key. After a failed or timed-out `complete`, we read the order's status before deciding. | `client.ts`, `core/orders.ts` |
| Order status | Read from `status`. Words like completed/success mean done, pending/requested mean open, cancelled means cancelled. **Anything else stops the order for a person** rather than guessing. | `extract.ts` `extractOrderStatus` |
| Install details | `orders/{id}` returns the ICCID plus an LPA string, or SM-DP+ address and activation code. | `extract.ts` `extractInstall` |
| Plans | `products/all` returns a list with id, name, countries, data, validity and our USD cost. | `extract.ts` `extractPlans` |
| Usage | `esims/details/{iccid}` returns data used, total and expiry. | `extract.ts` `extractUsage` |
| Wallet | `wallet` returns the balance in USD. | `extract.ts` `extractWalletCents` |

## Questions sent to RoamBuddy

Connection: IP allowlisting for port 3001, rate limits, uptime commitment, token expiry.
Orders: which call returns install details and example responses; request vs complete and how
long a requested order stays open; idempotency on retries; whether activation is required; usage
data; Apple one-tap install support; webhooks.
Wallet: credit terms, currency and funding from Nigeria, minimum top-up, expiry and withdrawal,
refunds to the wallet.
Commercial: wholesale price list, reselling under our brand, data-processing agreement.

## Known connection issue

From our cloud dev environment, connections to both servers on port 3001 were reset during the
TLS handshake. Test from a machine with a fixed IP and ask RoamBuddy whether it must be approved.
