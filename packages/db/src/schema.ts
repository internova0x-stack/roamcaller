// Database schema. Change it by editing this file and running `pnpm db:generate`,
// which writes a new SQL migration. Never edit a migration that has been applied.
//
// Money is always an integer in minor units (kobo, pesewas, cents) next to its currency.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** "test" uses the RoamBuddy sandbox and test balances; "live" is real money. */
export const MODES = ["test", "live"] as const;
export type Mode = (typeof MODES)[number];

export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Currency the partner is priced and billed in (ISO 4217). */
    currency: char("currency", { length: 3 }).notNull(),
    /** Margin over RoamBuddy cost, in basis points (2000 = 20%). */
    markupBps: integer("markup_bps").notNull().default(2000),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("partners_slug_key").on(t.slug), check("partners_markup_bps", sql`${t.markupBps} between 0 and 20000`)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    mode: text("mode", { enum: MODES }).notNull(),
    /** First characters of the key, shown in the admin so people can tell keys apart. */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the full key. The key itself is shown once and never stored. */
    hash: text("hash").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_key").on(t.hash)],
);

/** Units of a currency per 1 USD, set by the team. */
export const fxRates = pgTable("fx_rates", {
  currency: char("currency", { length: 3 }).primaryKey(),
  perUsd: numeric("per_usd", { precision: 18, scale: 6 }).notNull(),
  updatedAt: updatedAt(),
});

/** RoamBuddy plans, synced nightly. One catalogue per mode (sandbox ids may differ from live). */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mode: text("mode", { enum: MODES }).notNull(),
    rbPlanId: integer("rb_plan_id").notNull(),
    name: text("name").notNull(),
    coverage: text("coverage").array().notNull().default(sql`'{}'::text[]`),
    dataMb: integer("data_mb"),
    validityDays: integer("validity_days"),
    costUsdCents: integer("cost_usd_cents"),
    active: boolean("active").notNull().default(true),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plans_mode_rb_plan_id_key").on(t.mode, t.rbPlanId)],
);

export const ORDER_STATUSES = [
  "created", // balance held, nothing sent to RoamBuddy yet
  "reserved", // RoamBuddy order requested
  "completed", // RoamBuddy order completed and paid from our wallet; waiting for install details
  "delivered", // install details stored; partner charged
  "failed", // never completed; hold released
  "cancelled", // cancelled after delivery; refunded
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    mode: text("mode", { enum: MODES }).notNull(),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    /** The partner's own id for this purchase, e.g. their transaction id. */
    partnerReference: text("partner_reference"),
    /** The partner's id for the traveller (their customer), used by "My eSIMs". */
    customerRef: text("customer_ref"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("created"),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    costUsdCents: integer("cost_usd_cents").notNull(),
    rbOrderId: text("rb_order_id"),
    iccid: text("iccid"),
    failureReason: text("failure_reason"),
    /** Tries of the current step that ended blocked (no answer, no install details yet). Reset on progress. */
    attempts: integer("attempts").notNull().default(0),
    /** Whoever is advancing the order (API request or worker) holds it until this time. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_partner_created_idx").on(t.partnerId, t.createdAt),
    uniqueIndex("orders_rb_order_id_key").on(t.mode, t.rbOrderId),
    index("orders_status_idx").on(t.status),
    index("orders_customer_idx").on(t.partnerId, t.mode, t.customerRef),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    mode: text("mode", { enum: MODES }).notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.partnerId, t.mode, t.key] })],
);

export const esims = pgTable("esims", {
  iccid: text("iccid").primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  mode: text("mode", { enum: MODES }).notNull(),
  lpa: text("lpa"),
  smdpAddress: text("smdp_address"),
  activationCode: text("activation_code"),
  qrUrl: text("qr_url"),
  status: text("status"),
  dataTotalMb: integer("data_total_mb"),
  dataUsedMb: integer("data_used_mb"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  raw: jsonb("raw"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Double-entry ledger. Every posting is a set of rows whose amounts sum to zero per
 * currency. An account's balance is the sum of its rows. Rows are never updated or
 * deleted; corrections are new postings.
 *
 * Accounts (see core/ledger.ts): partner:<mode>:<id>, hold:<mode>:<id>, revenue:<mode>,
 * funding:<mode>, rb_wallet:<mode>, cogs:<mode>.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    postingId: uuid("posting_id").notNull(),
    account: text("account").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** What happened, e.g. "order_hold", "order_capture", "topup". */
    kind: text("kind").notNull(),
    /** What it happened to, e.g. the order id. (account, kind, ref) is unique, so a posting can't run twice. */
    ref: text("ref").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ledger_entries_once_key").on(t.account, t.currency, t.kind, t.ref),
    index("ledger_entries_account_idx").on(t.account, t.currency),
  ],
);

/** Outbox of webhook events for partners. The worker delivers and retries them. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    mode: text("mode", { enum: MODES }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_events_pending_idx").on(t.nextAttemptAt).where(sql`${t.deliveredAt} is null`)],
);

/**
 * A short-lived link a partner creates for one of its users to open the hosted
 * eSIM screens (/esim). The token itself is shown once; only its hash is stored.
 */
export const embedSessions = pgTable(
  "embed_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    mode: text("mode", { enum: MODES }).notNull(),
    customerRef: text("customer_ref").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("embed_sessions_token_hash_key").on(t.tokenHash)],
);
