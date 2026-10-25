// The order engine. An order moves:
//
//   created ──request──▶ reserved ──complete──▶ completed ──deliver──▶ delivered
//      │                    │
//      └──────── failed ◀───┘   (hold released, RoamBuddy order cancelled)
//
// advanceOrder() resumes an order from whatever state it is in, so the API request
// and the worker can both call it; a lease on the row stops them running at once.
// Money only moves in database transactions that also move the status, and every
// ledger posting is keyed by the order id, so repeating a step can't double-charge.

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { esims, fxRates, idempotencyKeys, orders, partners, plans, type Db, type Mode, type Tx } from "@roam/db";
import { extractInstall, extractOrderId, extractOrderStatus, RoamBuddyError, type RoamBuddyClient } from "@roam/roambuddy";
import type { Partner } from "./apiKeys.ts";
import { account, balance, post } from "./ledger.ts";
import { retailPriceMinor } from "./pricing.ts";
import type { RoamBuddyFor } from "./roambuddy.ts";
import { enqueueWebhook } from "./webhooks.ts";
import { getOrderView, toApiOrder } from "./views.ts";

export type Order = typeof orders.$inferSelect;

/** How many times to retry completing an order RoamBuddy still shows as open. */
export const MAX_COMPLETE_ATTEMPTS = 5;
type Plan = typeof plans.$inferSelect;

export class OrderError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export interface CreateOrderInput {
  partner: Partner;
  mode: Mode;
  planId: string;
  partnerReference?: string | null;
  idempotencyKey: string;
}

export async function createOrder(db: Db, rbFor: RoamBuddyFor, input: CreateOrderInput): Promise<{ orderId: string; replayed: boolean }> {
  const { partner, mode, idempotencyKey } = input;
  if (partner.status !== "active") throw new OrderError("partner_paused", 403, "This account is paused. Contact Roam Africa.");
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ planId: input.planId, reference: input.partnerReference ?? null }))
    .digest("hex");

  const result = await db.transaction(async (tx) => {
    const keyWhere = and(eq(idempotencyKeys.partnerId, partner.id), eq(idempotencyKeys.mode, mode), eq(idempotencyKeys.key, idempotencyKey));
    const [fresh] = await tx.insert(idempotencyKeys).values({ partnerId: partner.id, mode, key: idempotencyKey, requestHash }).onConflictDoNothing().returning();
    if (!fresh) {
      const [prev] = await tx.select().from(idempotencyKeys).where(keyWhere);
      if (!prev || prev.requestHash !== requestHash) {
        throw new OrderError("idempotency_key_reused", 422, "This Idempotency-Key was already used with a different request.");
      }
      if (!prev.orderId) throw new OrderError("request_in_progress", 409, "A request with this Idempotency-Key is still in progress.");
      return { orderId: prev.orderId, replayed: true };
    }

    // One order at a time per partner, so two orders can't both spend the same balance.
    await tx.select({ id: partners.id }).from(partners).where(eq(partners.id, partner.id)).for("update");

    const [plan] = await tx.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.mode, mode), eq(plans.active, true)));
    if (!plan || plan.costUsdCents === null) throw new OrderError("plan_not_found", 404, "No active plan with this id.");

    const priceMinor = retailPriceMinor({
      costUsdCents: plan.costUsdCents,
      markupBps: partner.markupBps,
      currency: partner.currency,
      perUsd: await rateFor(tx, partner.currency),
    });
    const available = await balance(tx, account.partner(mode, partner.id), partner.currency);
    if (available < priceMinor) {
      throw new OrderError("insufficient_balance", 402, `Prepaid balance is ${available} and this order costs ${priceMinor} (${partner.currency} minor units).`);
    }

    const [order] = await tx
      .insert(orders)
      .values({
        partnerId: partner.id,
        mode,
        planId: plan.id,
        partnerReference: input.partnerReference ?? null,
        priceMinor,
        currency: partner.currency,
        costUsdCents: plan.costUsdCents,
      })
      .returning();
    await post(tx, {
      kind: "order_hold",
      ref: order!.id,
      orderId: order!.id,
      legs: [
        { account: account.partner(mode, partner.id), currency: partner.currency, amountMinor: -priceMinor },
        { account: account.hold(mode, partner.id), currency: partner.currency, amountMinor: priceMinor },
      ],
    });
    await tx.update(idempotencyKeys).set({ orderId: order!.id }).where(keyWhere);
    return { orderId: order!.id, replayed: false };
  });

  if (!result.replayed) await advanceOrder(db, rbFor, result.orderId);
  return result;
}

async function rateFor(tx: Tx, currency: string): Promise<string> {
  if (currency === "USD") return "1";
  const [row] = await tx.select().from(fxRates).where(eq(fxRates.currency, currency));
  if (!row) throw new OrderError("pricing_unavailable", 503, `No exchange rate set for ${currency}.`);
  return row.perUsd;
}

/**
 * Moves an order as far as it can go right now. Safe to call repeatedly and from
 * several processes. Returns the order's status afterwards, or null if another
 * process holds the order.
 */
export async function advanceOrder(db: Db, rbFor: RoamBuddyFor, orderId: string, leaseSeconds = 90): Promise<Order["status"] | null> {
  const [leased] = await db
    .update(orders)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})` })
    .where(and(eq(orders.id, orderId), or(isNull(orders.leaseUntil), lt(orders.leaseUntil, sql`now()`))))
    .returning();
  if (!leased) return null;

  let order = leased;
  try {
    const [plan] = await db.select().from(plans).where(eq(plans.id, order.planId));
    const rb = rbFor(order.mode);
    for (;;) {
      const before = order.status;
      if (order.status === "created") order = await stepRequest(db, rb, order, plan!);
      else if (order.status === "reserved") order = await stepComplete(db, rb, order);
      else if (order.status === "completed") order = await stepDeliver(db, rb, order);
      if (order.status === before) break; // blocked for now, or finished
    }
    return order.status;
  } finally {
    await db.update(orders).set({ leaseUntil: null }).where(eq(orders.id, orderId));
  }
}

async function stepRequest(db: Db, rb: RoamBuddyClient, order: Order, plan: Plan): Promise<Order> {
  let rbOrderId: string | null;
  try {
    rbOrderId = extractOrderId(await rb.requestOrder(plan.rbPlanId));
  } catch (err) {
    // Nothing is paid at this step, so failing is safe even if the request reached RoamBuddy.
    return failOrder(db, order, `request: ${message(err)}`);
  }
  if (!rbOrderId) return failOrder(db, order, "request: response had no order id");
  return (await update(db, order, "created", { status: "reserved", rbOrderId, failureReason: null })) ?? order;
}

async function stepComplete(db: Db, rb: RoamBuddyClient, order: Order): Promise<Order> {
  const rbOrderId = order.rbOrderId!;
  // Check first: an earlier attempt may have completed it even though we never heard back.
  let remote = await remoteStatus(rb, rbOrderId);
  if (remote === "open") {
    try {
      await rb.completeOrder(rbOrderId);
      remote = "completed";
    } catch (err) {
      remote = await remoteStatus(rb, rbOrderId);
      if (remote === "open" && err instanceof RoamBuddyError && !err.retryable) {
        await cancelQuietly(rb, rbOrderId);
        return failOrder(db, order, `complete: ${message(err)}`);
      }
      if (remote === "open" && order.attempts + 1 >= MAX_COMPLETE_ATTEMPTS) {
        // RoamBuddy still shows it open after several tries: it was never paid, so give up cleanly.
        await cancelQuietly(rb, rbOrderId);
        return failOrder(db, order, `complete: gave up after ${MAX_COMPLETE_ATTEMPTS} tries: ${message(err)}`);
      }
      if (remote !== "completed" && remote !== "cancelled") {
        // Outcome unknown. Leave it reserved; the worker checks again.
        return (await update(db, order, "reserved", { attempts: order.attempts + 1, failureReason: `complete: ${message(err)} (will recheck)` })) ?? order;
      }
    }
  }
  if (remote === "cancelled") return failOrder(db, order, "complete: RoamBuddy shows the order as cancelled");
  if (remote === "unknown") return order;

  return db.transaction(async (tx) => {
    const updated = await update(tx, order, "reserved", { status: "completed", attempts: 0, failureReason: null });
    if (!updated) return order;
    await post(tx, {
      kind: "order_cost",
      ref: order.id,
      orderId: order.id,
      legs: [
        { account: account.rbWallet(order.mode), currency: "USD", amountMinor: -order.costUsdCents },
        { account: account.cogs(order.mode), currency: "USD", amountMinor: order.costUsdCents },
      ],
    });
    return updated;
  });
}

async function stepDeliver(db: Db, rb: RoamBuddyClient, order: Order): Promise<Order> {
  let raw: unknown = null;
  try {
    raw = await rb.order(order.rbOrderId!);
  } catch {
    // no answer: the worker tries again
  }
  const install = raw ? extractInstall(raw) : null;
  if (!install) {
    return (
      // The eSIM is paid for, so this never fails on its own; past a few tries it needs a person.
      (await update(db, order, "completed", { attempts: order.attempts + 1, failureReason: "deliver: no install details yet" })) ?? order
    );
  }
  return db.transaction(async (tx) => {
    const updated = await update(tx, order, "completed", { status: "delivered", iccid: install.iccid, attempts: 0, failureReason: null });
    if (!updated) return order;
    await tx
      .insert(esims)
      .values({
        iccid: install.iccid,
        orderId: order.id,
        partnerId: order.partnerId,
        mode: order.mode,
        lpa: install.lpa,
        smdpAddress: install.smdpAddress,
        activationCode: install.activationCode,
        qrUrl: install.qrUrl,
        raw,
      })
      .onConflictDoNothing();
    await post(tx, {
      kind: "order_capture",
      ref: order.id,
      orderId: order.id,
      legs: [
        { account: account.hold(order.mode, order.partnerId), currency: order.currency, amountMinor: -order.priceMinor },
        { account: account.revenue(order.mode), currency: order.currency, amountMinor: order.priceMinor },
      ],
    });
    const view = await getOrderView(tx, order.id);
    await enqueueWebhook(tx, { partnerId: order.partnerId, mode: order.mode, type: "order.delivered", data: toApiOrder(view!) });
    return updated;
  });
}

async function failOrder(db: Db, order: Order, reason: string): Promise<Order> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(orders)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), inArray(orders.status, ["created", "reserved"])))
      .returning();
    if (!updated) return order;
    await post(tx, {
      kind: "order_release",
      ref: order.id,
      orderId: order.id,
      legs: [
        { account: account.hold(order.mode, order.partnerId), currency: order.currency, amountMinor: -order.priceMinor },
        { account: account.partner(order.mode, order.partnerId), currency: order.currency, amountMinor: order.priceMinor },
      ],
    });
    const view = await getOrderView(tx, order.id);
    await enqueueWebhook(tx, { partnerId: order.partnerId, mode: order.mode, type: "order.failed", data: toApiOrder(view!) });
    return updated;
  });
}

/** Updates the order only if it is still in `from`. Returns null if it moved on meanwhile. */
async function update(tx: Tx, order: Order, from: Order["status"], set: Partial<Order>): Promise<Order | null> {
  const [row] = await tx
    .update(orders)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, from)))
    .returning();
  return row ?? null;
}

async function remoteStatus(rb: RoamBuddyClient, rbOrderId: string) {
  try {
    return extractOrderStatus(await rb.order(rbOrderId));
  } catch {
    return "unknown" as const;
  }
}

async function cancelQuietly(rb: RoamBuddyClient, rbOrderId: string) {
  try {
    await rb.cancelOrder(rbOrderId, "Could not be completed");
  } catch {
    // The order was never completed, so nothing was paid; a dangling request is harmless.
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Orders the worker should push forward: not finished, not leased, untouched for a minute. */
export async function ordersToAdvance(db: Db, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["created", "reserved", "completed"]),
        lt(orders.updatedAt, sql`now() - interval '1 minute'`),
        or(isNull(orders.leaseUntil), lt(orders.leaseUntil, sql`now()`)),
      ),
    )
    .orderBy(orders.updatedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
