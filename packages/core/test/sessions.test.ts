import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { plans } from "@roam/db";
import { createEmbedSession, createOrder, customerOrders, resolveEmbedSession } from "../src/index.ts";
import { makePartner, setup, type Harness } from "../src/testing.ts";

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h?.close();
});

describe("embed sessions", () => {
  it("resolves a fresh token, and refuses unknown or expired ones", async () => {
    const partner = await makePartner(h.db);
    const { token } = await createEmbedSession(h.db, { partnerId: partner.id, mode: "test", customerRef: "u1" });
    const found = await resolveEmbedSession(h.db, token);
    expect(found?.partner.id).toBe(partner.id);
    expect(found?.session.customerRef).toBe("u1");

    expect(await resolveEmbedSession(h.db, "es_" + "x".repeat(32))).toBeNull();
    expect(await resolveEmbedSession(h.db, "not-a-token")).toBeNull();
    const expired = await createEmbedSession(h.db, { partnerId: partner.id, mode: "test", customerRef: "u1", ttlMinutes: -1 });
    expect(await resolveEmbedSession(h.db, expired.token)).toBeNull();
  });

  it("lists only the traveller's own orders", async () => {
    const partner = await makePartner(h.db, { balanceMinor: 10_000_000 });
    const [plan] = await h.db.select().from(plans).where(and(eq(plans.mode, "test"), eq(plans.rbPlanId, 101)));
    const buy = (customerRef: string) =>
      createOrder(h.db, h.rbFor, { partner, mode: "test", planId: plan!.id, customerRef, idempotencyKey: randomUUID() });
    await buy("alice");
    await buy("alice");
    await buy("bob");
    const mine = await customerOrders(h.db, { partnerId: partner.id, mode: "test", customerRef: "alice" });
    expect(mine).toHaveLength(2);
    expect(mine.every((v) => v.order.customerRef === "alice")).toBe(true);
  });
});
