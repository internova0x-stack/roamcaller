// A fake RoamBuddy for demos and partner sandboxes, used in test mode when no real
// sandbox credentials are set. Unlike mock.ts (a separate HTTP server with orders in
// memory), it keeps no state: everything about an order is encoded in its id, so it
// works on serverless hosts where each request may run in a different process.
// Its responses follow the same assumed shapes as the mock (see extract.ts).
//
// Test plans: 9001 fails on request; 9002 never completes; 9003 shows its eSIM only
// after FAKE_DELIVERY_DELAY_MS.

import { createHash, randomBytes } from "node:crypto";
import { RoamBuddyError, type RoamBuddyApi } from "./client.ts";
import { MOCK_PLANS } from "./mock.ts";

export const FAKE_DELIVERY_DELAY_MS = 2 * 60_000;

function plan(planId: number) {
  const p = MOCK_PLANS.find((x) => x.plan_id === planId);
  if (!p) throw new RoamBuddyError("Plan not found", 404, { message: "Plan not found" }, `/products/${planId}`);
  return p;
}

/** "FAKE-<planId>-<created ms>-<random>" */
function parse(orderId: string): { planId: number; createdAt: number } {
  const m = /^FAKE-(\d+)-(\d+)-[0-9a-f]+$/.exec(orderId);
  if (!m) throw new RoamBuddyError("Order not found", 404, { message: "Order not found" }, `/products/orders/${orderId}`);
  return { planId: Number(m[1]), createdAt: Number(m[2]) };
}

function esimFor(orderId: string) {
  const h = createHash("sha256").update(orderId).digest("hex");
  const digits = BigInt("0x" + h.slice(0, 15)).toString().padStart(16, "0").slice(0, 16);
  return { iccid: `8943${digits}`, smdp_address: "smdp.sandbox.roamcaller.test", activation_code: `SBX-${h.slice(16, 28).toUpperCase()}` };
}

export class FakeRoamBuddy implements RoamBuddyApi {
  async authenticate() {
    return { token: "fake" };
  }
  async wallet() {
    return { data: { wallet_balance: "100000.00" } };
  }
  async products() {
    return { data: MOCK_PLANS };
  }
  async product(planId: number) {
    return { data: plan(planId) };
  }
  async countries() {
    return { data: [...new Set(MOCK_PLANS.flatMap((p) => p.countries))] };
  }
  async requestOrder(planId: number) {
    const p = plan(planId);
    if (p.plan_id === 9001) throw new RoamBuddyError("Upstream error", 500, { message: "Upstream error" }, "/products/orders/request");
    return { data: { order_id: `FAKE-${p.plan_id}-${Date.now()}-${randomBytes(4).toString("hex")}`, status: "pending" } };
  }
  async completeOrder(orderId: string) {
    const { planId } = parse(orderId);
    if (planId === 9002) throw new RoamBuddyError("Upstream error", 500, { message: "Upstream error" }, "/products/orders/complete");
    return { data: { order_id: orderId, status: "completed" } };
  }
  async cancelOrder(orderId: string, _reason: string) {
    parse(orderId);
    return { data: { order_id: orderId, status: "cancelled" } };
  }
  async order(orderId: string) {
    const { planId, createdAt } = parse(orderId);
    if (planId === 9002) return { data: { order_id: orderId, status: "pending", esims: [] } };
    const ready = planId !== 9003 || Date.now() - createdAt >= FAKE_DELIVERY_DELAY_MS;
    return { data: { order_id: orderId, status: "completed", esims: ready ? [esimFor(orderId)] : [] } };
  }
  async esimDetails(iccid: string) {
    return { data: { iccid, status: "installed", total_mb: 5120, used_mb: 300, expires_at: null } };
  }
  async validateEsim(iccid: string) {
    return { data: { iccid, valid: true } };
  }
  async activateEsim(iccid: string) {
    return { data: { iccid, status: "active" } };
  }
  async topupPackages(iccid: string) {
    return { data: MOCK_PLANS.filter((p) => p.plan_id < 9000).map((p) => ({ ...p, iccid })) };
  }
  async applyTopup(iccid: string, planId: number) {
    plan(planId);
    return { data: { iccid, plan_id: planId, status: "completed" } };
  }
}
