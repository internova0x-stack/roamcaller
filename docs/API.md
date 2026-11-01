# Roam Caller Partner API

Sell travel eSIMs for 108+ countries inside your product. This is version 1.

- Base URL: `https://www.roamcaller.com/api/v1`. The sandbox runs there now with test keys; live keys come later.
- JSON in and out. Amounts are integers in minor units (kobo for NGN, cents for USD) with their
  currency, plus a `display` string.
- Every partner has two keys. `rc_test_…` keys use test balances and test eSIMs: nothing is
  charged. `rc_live_…` keys are real.

## Quick start

Ask us for a sandbox key (`rc_test_…`). Then, in a terminal:

```bash
# 1. List plans for a country
curl "https://www.roamcaller.com/api/v1/plans?country=AE" \
  -H "Authorization: Bearer rc_test_YOUR_KEY"

# 2. Buy one: use a plan id from step 1, and any unique Idempotency-Key
curl -X POST https://www.roamcaller.com/api/v1/orders \
  -H "Authorization: Bearer rc_test_YOUR_KEY" \
  -H "Idempotency-Key: my-first-order" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "PLAN_ID", "customer_ref": "user-123"}'

# 3. Check your sandbox balance
curl https://www.roamcaller.com/api/v1/balance \
  -H "Authorization: Bearer rc_test_YOUR_KEY"
```

The order comes back `delivered` with sandbox install codes. Sandbox plans with country code `ZZ` fail or
deliver late on purpose, so you can test your error handling.

## Authentication

```
Authorization: Bearer rc_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Keep keys on your server. Never put them in a mobile app or a web page.

## Prepaid balance

Orders are paid from your prepaid balance with Roam Caller. When it can't cover an order, the
order is refused with `402 insufficient_balance`. Top up by bank transfer; we credit the balance
when it lands.

`GET /v1/balance`

```json
{
  "object": "balance",
  "currency": "NGN",
  "available": { "amount_minor": 3288800, "display": "32,888.00" },
  "held": { "amount_minor": 0, "display": "0.00" }
}
```

`held` is money set aside for orders still processing.

## Plans

`GET /v1/plans?country=AE` lists active plans at your prices. `country` (ISO 3166 two-letter
code) is optional.

```json
{
  "object": "list",
  "data": [
    {
      "object": "plan",
      "id": "aadd5366-ab92-4ac1-b032-120f3a3e7471",
      "name": "United Arab Emirates 5GB 30 days",
      "coverage": ["AE"],
      "data_mb": 5120,
      "validity_days": 30,
      "price": { "amount_minor": 1711200, "currency": "NGN", "display": "17,112.00" }
    }
  ]
}
```

`GET /v1/plans/{id}` returns one plan. Prices can change when exchange rates change; the price
charged is the one returned when the order is created.

## Orders

### Create an order

`POST /v1/orders`

Headers: `Idempotency-Key` is **required**. Use a value unique to the purchase, such as your
transaction id. If a request times out, send it again with the same key and body: you get the
same order back (status `200` and `Idempotent-Replayed: true`), never a second eSIM. Reusing a key
with a different body returns `422 idempotency_key_reused`.

```json
{ "plan_id": "aadd5366-ab92-4ac1-b032-120f3a3e7471", "reference": "txn-001" }
```

`reference` (optional, up to 100 characters) is your own id for the purchase, returned on the order and webhooks.
`customer_ref` (optional, up to 100 characters) is your own id for the customer; see Hosted eSIM screens.

Response `201`:

```json
{
  "object": "order",
  "id": "3a07de36-98e5-42b9-b817-954400074920",
  "status": "delivered",
  "reference": "txn-001",
  "plan": { "id": "aadd5366-…", "name": "United Arab Emirates 5GB 30 days" },
  "price": { "amount_minor": 1711200, "currency": "NGN", "display": "17,112.00" },
  "esim": {
    "object": "esim",
    "iccid": "89430000000000000101",
    "install": {
      "lpa": "LPA:1$smdp.example.com$ACT-000101",
      "smdp_address": "smdp.example.com",
      "activation_code": "ACT-000101",
      "ios_install_url": "https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA%3A1%24…",
      "qr_url": null
    },
    "status": null,
    "data_total_mb": null,
    "data_used_mb": null,
    "expires_at": null
  },
  "created_at": "2026-10-25T10:55:22.443Z",
  "updated_at": "2026-10-25T10:55:22.516Z"
}
```

Order `status`:

| Status | Meaning | Your balance |
|---|---|---|
| `processing` | We're getting the eSIM. Usually seconds; occasionally minutes. Wait for the webhook or poll `GET /v1/orders/{id}`. | Price is held |
| `delivered` | `esim.install` is ready to show your customer. | Charged |
| `failed` | We couldn't get the eSIM. Nothing is charged. | Hold released |
| `cancelled` | Cancelled after delivery and refunded (arrives with refunds, see "Coming next"). | Refunded |

### Installing on the customer's phone

- **iPhone (iOS 17.4 and later):** open `ios_install_url`. The phone offers to install the eSIM.
- **Android:** pass `lpa` to the system eSIM installer, or show it as a QR code.
- **Any phone:** show `lpa` as a QR code for the customer to scan in Settings, or show
  `smdp_address` and `activation_code` for manual entry.

### Read orders

- `GET /v1/orders/{id}`
- `GET /v1/orders?limit=20` (newest first, up to 100)

## eSIMs

`GET /v1/esims/{iccid}` returns the eSIM with its install details and latest usage. Usage is
refreshed about every 30 minutes.

## Hosted eSIM screens

The fastest way to launch: we host the screens (plans, checkout, install, My eSIMs), and your app opens them for a
signed-in customer. See them at https://www.roamcaller.com/demo.

1. Your server creates a session for the customer:

   `POST /v1/sessions`

   ```json
   { "customer_ref": "your-user-id-123" }
   ```

   Response `201`:

   ```json
   { "object": "session", "url": "https://www.roamcaller.com/esim?t=es_…", "expires_at": "…", "customer_ref": "your-user-id-123" }
   ```

2. Your app opens `url` in a web view. The link works for 2 hours and only for that customer. Never put your API key
   in the app; create sessions from your server.
3. When the customer pays, we take the price from your prepaid balance and send `order.delivered` with
   `customer_ref` set, so you can charge the customer's balance with you.

`customer_ref` is your own id for the customer. Use the same value every time for the same person, so "My eSIMs"
shows all of their eSIMs. You can also send it on `POST /v1/orders` when you build your own screens.

## Webhooks

Give us an HTTPS URL and we send a `POST` for each event:

| Event | When |
|---|---|
| `order.delivered` | An order's eSIM is ready. `data` is the order. |
| `order.failed` | An order failed and its hold was released. `data` is the order. |
| `esim.data_low` | 80% of the data is used. `data` is the eSIM. Sent once. |
| `esim.expired` | The plan expired. `data` is the eSIM. Sent once. |

```json
{ "id": "…", "type": "order.delivered", "mode": "test", "created_at": "…", "data": { "object": "order", … } }
```

**Verify every webhook.** The `RoamCaller-Signature` header looks like `t=1792900000,v1=5f3c…`.
Compute HMAC-SHA256 of `"<t>.<raw request body>"` with your webhook signing secret and compare it
to `v1` in constant time. Reject the request if they differ or if `t` is more than 5 minutes old.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Answer with any `2xx` within 10 seconds. Otherwise we retry after 1 minute, 5 minutes, 30 minutes,
2 hours, 6 hours, then every 12 hours, up to 10 attempts. Events can arrive more than once or out
of order: use `id` to skip duplicates, and `GET /v1/orders/{id}` for the current state.

## Errors

```json
{ "error": { "code": "insufficient_balance", "message": "Prepaid balance is 100000 and this order costs 1581000 (NGN minor units)." } }
```

| HTTP | `code` | What to do |
|---|---|---|
| 400 | `invalid_request` | Fix the request; `message` says which field. |
| 400 | `idempotency_key_required` | Add an `Idempotency-Key` header. |
| 401 | `unauthorized` | Check the API key. |
| 402 | `insufficient_balance` | Top up your prepaid balance. |
| 403 | `partner_paused` | Contact Roam Caller. |
| 404 | `plan_not_found`, `order_not_found`, `esim_not_found` | Check the id. |
| 409 | `request_in_progress` | The same Idempotency-Key is still being processed; retry shortly. |
| 422 | `idempotency_key_reused` | Use a new key for a new purchase. |
| 500 | `internal_error` | Retry with the same Idempotency-Key. |
| 503 | `pricing_unavailable` | Temporary; retry later. |

## Coming next

Top-ups, cancellations and refunds, and hosted eSIM screens you can open inside your app.
