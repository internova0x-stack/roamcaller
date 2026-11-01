import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { esims, partners, plans, webhookEvents } from "@roam/db";
import { createOrder, deliverWebhooks, refreshEsims } from "../src/index.ts";
import { makePartner, setup, type Harness } from "../src/testing.ts";

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h?.close();
});

async function deliveredOrder(webhookUrl: string | null = null) {
  const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
  if (webhookUrl) await h.db.update(partners).set({ webhookUrl, webhookSecret: "whsec_test" }).where(eq(partners.id, partner.id));
  const [plan] = await h.db.select().from(plans).where(and(eq(plans.mode, "test"), eq(plans.rbPlanId, 101)));
  await createOrder(h.db, h.rbFor, { partner, mode: "test", planId: plan!.id, idempotencyKey: randomUUID() });
  return partner;
}

describe("deliverWebhooks", () => {
  it("signs each event and retries later when the partner's endpoint fails", async () => {
    const partner = await deliveredOrder("https://partner.example/hooks");
    const received: { body: string; signature: string }[] = [];
    let status = 500;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      received.push({ body: String(init.body), signature: (init.headers as Record<string, string>)["RoamCaller-Signature"]! });
      return new Response(null, { status });
    }) as unknown as typeof fetch;

    expect(await deliverWebhooks(h.db, fakeFetch)).toMatchObject({ failed: 1 });
    let [event] = await h.db.select().from(webhookEvents).where(eq(webhookEvents.partnerId, partner.id));
    expect(event).toMatchObject({ attempts: 1, deliveredAt: null, lastError: "HTTP 500" });
    expect(event!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    // Make it due again; this time the partner answers 200.
    await h.db.update(webhookEvents).set({ nextAttemptAt: new Date(0) }).where(eq(webhookEvents.id, event!.id));
    status = 200;
    expect(await deliverWebhooks(h.db, fakeFetch)).toMatchObject({ sent: 1 });
    [event] = await h.db.select().from(webhookEvents).where(eq(webhookEvents.partnerId, partner.id));
    expect(event!.deliveredAt).not.toBeNull();

    const last = received.at(-1)!;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(last.signature)!;
    expect(createHmac("sha256", "whsec_test").update(`${t}.${last.body}`).digest("hex")).toBe(v1);
    expect(JSON.parse(last.body)).toMatchObject({ id: event!.id, type: "order.delivered", data: { object: "order", status: "delivered" } });
  });
});

describe("refreshEsims", () => {
  it("stores usage and sends esim.data_low only once", async () => {
    const partner = await deliveredOrder();
    // The mock reports 300 of 5120 MB used: not low yet.
    await refreshEsims(h.db, h.rbFor);
    let low = await h.db.select().from(webhookEvents).where(and(eq(webhookEvents.partnerId, partner.id), eq(webhookEvents.type, "esim.data_low")));
    expect(low).toHaveLength(0);

    const iccid = [...h.mock.orders.values()].at(-1)!.iccid!;
    h.mock.usedMbOverride = 4500;
    for (let i = 0; i < 2; i++) {
      await h.db.update(esims).set({ checkedAt: null }).where(eq(esims.iccid, iccid));
      await refreshEsims(h.db, h.rbFor);
    }
    low = await h.db.select().from(webhookEvents).where(and(eq(webhookEvents.partnerId, partner.id), eq(webhookEvents.type, "esim.data_low")));
    expect(low).toHaveLength(1);
  });
});
