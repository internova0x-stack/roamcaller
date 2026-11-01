// The stateless fake used by demos: orders must work even when every call goes
// to a fresh FakeRoamBuddy, as happens on serverless hosts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { plans } from "@roam/db";
import { FakeRoamBuddy } from "@roam/roambuddy";
import { account, balance, createOrder, getOrderView, syncPlans, toApiOrder, type RoamBuddyFor } from "../src/index.ts";
import { makePartner, setup, type Harness } from "../src/testing.ts";

let h: Harness;
// A new fake for every call: nothing may survive between calls.
const fresh: RoamBuddyFor = () => new FakeRoamBuddy();

beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h?.close();
});

describe("FakeRoamBuddy", () => {
  it("delivers an eSIM through the order engine with no shared state", async () => {
    await syncPlans(h.db, new FakeRoamBuddy(), "test");
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const [plan] = await h.db.select().from(plans).where(and(eq(plans.mode, "test"), eq(plans.rbPlanId, 102)));
    const { orderId } = await createOrder(h.db, fresh, { partner, mode: "test", planId: plan!.id, idempotencyKey: randomUUID() });

    const view = (await getOrderView(h.db, orderId))!;
    expect(view.order.status).toBe("delivered");
    const api = toApiOrder(view);
    expect(api.esim?.iccid).toMatch(/^8943\d{16}$/);
    expect(api.esim?.install.lpa).toMatch(/^LPA:1\$smdp\.sandbox\.roamcaller\.test\$SBX-/);
    expect(await balance(h.db, account.hold("test", partner.id), "NGN")).toBe(0);
  });

  it("fails cleanly on the failing test plan", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
    const [plan] = await h.db.select().from(plans).where(and(eq(plans.mode, "test"), eq(plans.rbPlanId, 9001)));
    const { orderId } = await createOrder(h.db, fresh, { partner, mode: "test", planId: plan!.id, idempotencyKey: randomUUID() });
    expect((await getOrderView(h.db, orderId))!.order.status).toBe("failed");
    expect(await balance(h.db, account.partner("test", partner.id), "NGN")).toBe(5_000_000);
  });
});
