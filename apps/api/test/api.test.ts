import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApiKey } from "@roam/core";
import { makePartner, setup, type Harness } from "@roam/core/testing";
import { buildApp } from "../src/app.ts";

let h: Harness;
let app: ReturnType<typeof buildApp>;
let key: string;
let otherKey: string;

beforeAll(async () => {
  h = await setup();
  app = buildApp({ db: h.db, rbFor: h.rbFor });
  const partner = await makePartner(h.db, { balanceMinor: 5_000_000 });
  key = await createApiKey(h.db, partner.id, "test");
  const other = await makePartner(h.db, { balanceMinor: 5_000_000 });
  otherKey = await createApiKey(h.db, other.id, "test");
});
afterAll(async () => {
  await app?.close();
  await h?.close();
});

const auth = (k = key) => ({ authorization: `Bearer ${k}` });

describe("partner API", () => {
  it("explains itself to someone opening it in a browser, and answers unknown paths in JSON", async () => {
    for (const url of ["/v1", "/v1/"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("running");
    }
    const missing = await app.inject({ method: "GET", url: "/v1/nope", headers: auth() });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("rejects requests without a valid key", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plans" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
    const bad = await app.inject({ method: "GET", url: "/v1/plans", headers: auth("rc_test_" + "x".repeat(32)) });
    expect(bad.statusCode).toBe(401);
  });

  it("lists plans priced in the partner's currency, filtered by country", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plans?country=gb", headers: auth() });
    expect(res.statusCode).toBe(200);
    const uk = res.json().data.find((p: any) => p.name.startsWith("United Kingdom"));
    expect(uk.price).toEqual({ amount_minor: 1_581_000, currency: "NGN", display: "15,810.00" });
    expect(res.json().data.every((p: any) => p.coverage.includes("GB"))).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain("cost");
  });

  it("buys an eSIM, replays on retry, and keeps orders private to their partner", async () => {
    const plans = (await app.inject({ method: "GET", url: "/v1/plans?country=GB", headers: auth() })).json().data;
    const planId = plans.find((p: any) => p.name.startsWith("United Kingdom")).id;
    const headers = { ...auth(), "idempotency-key": randomUUID() };

    const created = await app.inject({ method: "POST", url: "/v1/orders", headers, payload: { plan_id: planId, reference: "txn-42" } });
    expect(created.statusCode).toBe(201);
    const order = created.json();
    expect(order).toMatchObject({ object: "order", status: "delivered", reference: "txn-42" });
    expect(order.esim.install.lpa).toMatch(/^LPA:1\$/);

    const replay = await app.inject({ method: "POST", url: "/v1/orders", headers, payload: { plan_id: planId, reference: "txn-42" } });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json().id).toBe(order.id);

    expect((await app.inject({ method: "GET", url: `/v1/orders/${order.id}`, headers: auth() })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/orders/${order.id}`, headers: auth(otherKey) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/esims/${order.esim.iccid}`, headers: auth() })).json().iccid).toBe(order.esim.iccid);
    expect((await app.inject({ method: "GET", url: `/v1/esims/${order.esim.iccid}`, headers: auth(otherKey) })).statusCode).toBe(404);

    const bal = (await app.inject({ method: "GET", url: "/v1/balance", headers: auth() })).json();
    expect(bal).toMatchObject({ currency: "NGN", available: { amount_minor: 5_000_000 - 1_581_000 }, held: { amount_minor: 0 } });
  });

  it("creates a hosted-screens session for a customer", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/sessions", headers: auth(), payload: { customer_ref: "user-77" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ object: "session", customer_ref: "user-77" });
    expect(res.json().url).toMatch(/\/esim\?t=es_[A-Za-z0-9_-]{32}$/);
    const missing = await app.inject({ method: "POST", url: "/v1/sessions", headers: auth(), payload: {} });
    expect(missing.statusCode).toBe(400);
  });

  it("explains what's wrong with a bad order request", async () => {
    const noKey = await app.inject({ method: "POST", url: "/v1/orders", headers: auth(), payload: { plan_id: randomUUID() } });
    expect(noKey.json().error.code).toBe("idempotency_key_required");
    const badBody = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...auth(), "idempotency-key": "k1" }, payload: { plan_id: "nope" } });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json().error.message).toContain("plan_id");
    const unknown = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...auth(), "idempotency-key": "k2" }, payload: { plan_id: randomUUID() } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("plan_not_found");
  });
});
