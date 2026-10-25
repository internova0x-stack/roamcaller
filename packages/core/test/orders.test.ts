import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ledgerEntries, orders, plans, webhookEvents } from "@roam/db";
import { account, advanceOrder, balance, createOrder, creditPartner, getOrderView, OrderError, toApiOrder, MAX_COMPLETE_ATTEMPTS } from "../src/index.ts";
import { makePartner, setup, type Harness } from "../src/testing.ts";

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h?.close();
});

async function planId(rbPlanId: number) {
  const [p] = await h.db.select().from(plans).where(and(eq(plans.mode, "test"), eq(plans.rbPlanId, rbPlanId)));
  return p!.id;
}

const UK = 101; // $8.50 → ₦15,810.00 at 20% markup and ₦1,550/$
const UK_PRICE = 1_581_000;

async function balances(partnerId: string) {
  return {
    partner: await balance(h.db, account.partner("test", partnerId), "NGN"),
    hold: await balance(h.db, account.hold("test", partnerId), "NGN"),
  };
}

function order(partner: Awaited<ReturnType<typeof makePartner>>, rbPlanId: number, key = randomUUID()) {
  return planId(rbPlanId).then((id) => createOrder(h.db, h.rbFor, { partner, mode: "test", planId: id, idempotencyKey: key, partnerReference: "txn-1" }));
}

describe("createOrder", () => {
  it("delivers an eSIM, charges the partner and records our cost", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const { orderId, replayed } = await order(partner, UK);
    expect(replayed).toBe(false);

    const view = (await getOrderView(h.db, orderId))!;
    expect(view.order.status).toBe("delivered");
    const api = toApiOrder(view);
    expect(api.price).toEqual({ amount_minor: UK_PRICE, currency: "NGN", display: "15,810.00" });
    expect(api.esim?.install.lpa).toMatch(/^LPA:1\$smdp\.mock\.roambuddy\.test\$ACT-/);
    expect(api.esim?.install.ios_install_url).toContain("esimsetup.apple.com");

    expect(await balances(partner.id)).toEqual({ partner: 5_000_000 - UK_PRICE, hold: 0 });
    const cost = await h.db.select().from(ledgerEntries).where(and(eq(ledgerEntries.orderId, orderId), eq(ledgerEntries.kind, "order_cost")));
    expect(cost.map((c) => [c.account, c.currency, c.amountMinor]).sort()).toEqual([
      ["cogs:test", "USD", 850],
      ["rb_wallet:test", "USD", -850],
    ]);
    const hooks = await h.db.select().from(webhookEvents).where(eq(webhookEvents.partnerId, partner.id));
    expect(hooks.map((e) => e.type)).toEqual(["order.delivered"]);
  });

  it("returns the same order when the request is retried with the same key", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const key = randomUUID();
    const first = await order(partner, UK, key);
    const callsBefore = h.mock.calls.length;
    const again = await order(partner, UK, key);
    expect(again).toEqual({ orderId: first.orderId, replayed: true });
    expect(h.mock.calls.length).toBe(callsBefore);
    expect((await balances(partner.id)).partner).toBe(5_000_000 - UK_PRICE);
  });

  it("rejects a key reused for a different request", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const key = randomUUID();
    await order(partner, UK, key);
    await expect(order(partner, 102, key)).rejects.toMatchObject({ code: "idempotency_key_reused", httpStatus: 422 });
  });

  it("refuses an order the balance can't cover, and the key works after a top-up", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 100_000 });
    const key = randomUUID();
    await expect(order(partner, UK, key)).rejects.toMatchObject({ code: "insufficient_balance", httpStatus: 402 });
    expect(await h.db.select().from(orders).where(eq(orders.partnerId, partner.id))).toHaveLength(0);

    await h.db.transaction((tx) => creditPartner(tx, { mode: "test", partnerId: partner.id, currency: "NGN", amountMinor: 2_000_000, ref: "bank-1" }));
    const { orderId } = await order(partner, UK, key);
    expect((await getOrderView(h.db, orderId))!.order.status).toBe("delivered");
  });

  it("lets only one of two simultaneous orders spend the last of the balance", async () => {
    const partner = await makePartner(h.db, { balanceMinor: UK_PRICE + 1000 });
    const results = await Promise.allSettled([order(partner, UK), order(partner, UK)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OrderError);
    expect(rejected.reason.code).toBe("insufficient_balance");
    expect((await balances(partner.id)).partner).toBe(1000);
  });

  it("fails cleanly and refunds the hold when RoamBuddy rejects the request", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const { orderId } = await order(partner, 9001);
    expect((await getOrderView(h.db, orderId))!.order.status).toBe("failed");
    expect(await balances(partner.id)).toEqual({ partner: 5_000_000, hold: 0 });
    const hooks = await h.db.select().from(webhookEvents).where(eq(webhookEvents.partnerId, partner.id));
    expect(hooks.map((e) => e.type)).toEqual(["order.failed"]);
  });

  it("keeps the order and the hold while completion is uncertain, then cancels after the retry limit", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const { orderId } = await order(partner, 9002);
    let view = (await getOrderView(h.db, orderId))!;
    expect(view.order.status).toBe("reserved");
    expect((await balances(partner.id)).hold).toBe(view.order.priceMinor);

    for (let i = 1; i < MAX_COMPLETE_ATTEMPTS; i++) await advanceOrder(h.db, h.rbFor, orderId);
    view = (await getOrderView(h.db, orderId))!;
    expect(view.order.status).toBe("failed");
    expect(await balances(partner.id)).toEqual({ partner: 5_000_000, hold: 0 });
    expect(h.mock.orders.get(view.order.rbOrderId!)?.status).toBe("cancelled");
  });

  it("holds the money while install details are late, and delivers when they appear", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const { orderId } = await order(partner, 9003);
    let view = (await getOrderView(h.db, orderId))!;
    expect(view.order.status).toBe("completed");
    expect((await balances(partner.id)).hold).toBe(view.order.priceMinor);

    h.mock.delayedPlans.delete(9003);
    expect(await advanceOrder(h.db, h.rbFor, orderId)).toBe("delivered");
    view = (await getOrderView(h.db, orderId))!;
    expect(view.esim?.iccid).toBeTruthy();
    expect((await balances(partner.id)).hold).toBe(0);
  });

  it("does not let two processes advance the same order at once", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    h.mock.delayedPlans.add(9003);
    const { orderId } = await order(partner, 9003);
    h.mock.delayedPlans.delete(9003);
    const [a, b] = await Promise.all([advanceOrder(h.db, h.rbFor, orderId), advanceOrder(h.db, h.rbFor, orderId)]);
    expect([a, b].sort()).toEqual(["delivered", null].sort());
    const captures = await h.db.select().from(ledgerEntries).where(and(eq(ledgerEntries.orderId, orderId), eq(ledgerEntries.kind, "order_capture")));
    expect(captures).toHaveLength(2); // one posting, two legs
  });
});

describe("ledger guards", () => {
  it("rejects an unbalanced posting at commit", async () => {
    await expect(
      h.db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values({ postingId: randomUUID(), account: "x", currency: "NGN", amountMinor: 5, kind: "bad", ref: "1" });
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it("refuses to change existing rows", async () => {
    const err = await h.db.update(ledgerEntries).set({ amountMinor: 0 }).catch((e: Error) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/append-only/);
  });
});
