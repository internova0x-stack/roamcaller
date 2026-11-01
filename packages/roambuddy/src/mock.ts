// A stand-in for the RoamBuddy partner API, for tests and local development.
// Its response shapes are our ASSUMPTIONS (see extract.ts) and must be updated
// to match the real API after the first sandbox order.
//
// Failure switches, by plan id (country code ZZ, so they stay out of real country searches): 9001 fails on request, 9002 fails on complete,
// 9003 completes but its order details show no eSIM while 9003 is in state.delayedPlans.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockState {
  walletCents: number;
  orders: Map<string, { planId: number; status: "requested" | "completed" | "cancelled"; iccid: string | null }>;
  calls: string[];
  /** Plans whose orders show no eSIM yet. Remove a plan to let its eSIMs appear. */
  delayedPlans: Set<number>;
  /** Data used that eSIM details report, in MB (default 300 of 5120). */
  usedMbOverride?: number;
}

export const MOCK_PLANS = [
  { plan_id: 101, name: "United Kingdom 5GB 30 days", countries: ["GB"], data_gb: 5, validity_days: 30, price: 8.5 },
  { plan_id: 102, name: "United Arab Emirates 5GB 30 days", countries: ["AE"], data_gb: 5, validity_days: 30, price: 9.2 },
  { plan_id: 103, name: "Saudi Arabia 10GB 30 days", countries: ["SA"], data_gb: 10, validity_days: 30, price: 15 },
  { plan_id: 104, name: "Africa 3GB 15 days", countries: ["NG", "GH", "KE", "ZA", "EG", "MA"], data_gb: 3, validity_days: 15, price: 10 },
  // Sample catalogue for demos: Roam Caller's 11 home markets, popular destinations and regional plans.
  // Prices are illustrative until RoamBuddy's real catalogue replaces this file's role.
  { plan_id: 105, name: "Nigeria 5GB 30 days", countries: ["NG"], data_gb: 5, validity_days: 30, price: 9 },
  { plan_id: 106, name: "Ghana 5GB 30 days", countries: ["GH"], data_gb: 5, validity_days: 30, price: 9.5 },
  { plan_id: 107, name: "Kenya 5GB 30 days", countries: ["KE"], data_gb: 5, validity_days: 30, price: 8.8 },
  { plan_id: 108, name: "South Africa 5GB 30 days", countries: ["ZA"], data_gb: 5, validity_days: 30, price: 8 },
  { plan_id: 109, name: "Egypt 5GB 30 days", countries: ["EG"], data_gb: 5, validity_days: 30, price: 7.5 },
  { plan_id: 110, name: "Morocco 5GB 30 days", countries: ["MA"], data_gb: 5, validity_days: 30, price: 7 },
  { plan_id: 111, name: "Tunisia 3GB 15 days", countries: ["TN"], data_gb: 3, validity_days: 15, price: 6.5 },
  { plan_id: 112, name: "Senegal 3GB 15 days", countries: ["SN"], data_gb: 3, validity_days: 15, price: 8 },
  { plan_id: 113, name: "Côte d'Ivoire 3GB 15 days", countries: ["CI"], data_gb: 3, validity_days: 15, price: 8 },
  { plan_id: 114, name: "Cameroon 3GB 15 days", countries: ["CM"], data_gb: 3, validity_days: 15, price: 9 },
  { plan_id: 115, name: "Uganda 3GB 15 days", countries: ["UG"], data_gb: 3, validity_days: 15, price: 8.5 },
  { plan_id: 116, name: "United States 5GB 30 days", countries: ["US"], data_gb: 5, validity_days: 30, price: 8.5 },
  { plan_id: 117, name: "France 5GB 30 days", countries: ["FR"], data_gb: 5, validity_days: 30, price: 7.5 },
  { plan_id: 118, name: "Türkiye 5GB 30 days", countries: ["TR"], data_gb: 5, validity_days: 30, price: 7 },
  { plan_id: 119, name: "China 5GB 30 days", countries: ["CN"], data_gb: 5, validity_days: 30, price: 10 },
  { plan_id: 120, name: "Canada 5GB 30 days", countries: ["CA"], data_gb: 5, validity_days: 30, price: 11 },
  { plan_id: 121, name: "Europe 10GB 30 days", countries: ["FR", "DE", "IT", "ES", "PT", "NL", "BE", "IE", "GR", "AT", "CH", "SE", "PL", "GB"], data_gb: 10, validity_days: 30, price: 15 },
  { plan_id: 122, name: "Middle East 5GB 30 days", countries: ["AE", "SA", "QA", "OM", "KW", "BH", "JO"], data_gb: 5, validity_days: 30, price: 14 },
  { plan_id: 123, name: "East Africa 5GB 30 days", countries: ["KE", "UG", "TZ", "RW"], data_gb: 5, validity_days: 30, price: 12 },
  { plan_id: 124, name: "West Africa 5GB 30 days", countries: ["NG", "GH", "SN", "CI", "BJ", "TG", "BF", "ML", "NE", "GN", "SL", "LR", "GM"], data_gb: 5, validity_days: 30, price: 13 },
  { plan_id: 125, name: "Global 3GB 30 days", countries: ["NG", "GH", "KE", "ZA", "EG", "MA", "GB", "US", "AE", "SA", "FR", "DE", "TR", "CN", "CA", "IN", "BR", "JP"], data_gb: 3, validity_days: 30, price: 18 },
  { plan_id: 9001, name: "Sandbox test: fails on request", countries: ["ZZ"], data_gb: 1, validity_days: 7, price: 1 },
  { plan_id: 9002, name: "Sandbox test: fails on complete", countries: ["ZZ"], data_gb: 1, validity_days: 7, price: 1 },
  { plan_id: 9003, name: "Sandbox test: delivery delayed", countries: ["ZZ"], data_gb: 1, validity_days: 7, price: 1 },
];

const TOKEN = "mock-token";

export function createMockRoamBuddy(state: MockState = newMockState()): { server: Server; state: MockState } {
  let seq = 100;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    state.calls.push(`${req.method} ${path}`);
    const body = req.method === "POST" ? await readJson(req) : {};

    if (path === "/wl-account/authenticate") {
      return body.username && body.password ? send(res, 200, { token: TOKEN }) : send(res, 401, { message: "Invalid credentials" });
    }
    if (req.headers.authorization !== TOKEN) return send(res, 401, { message: "Unauthorized" });

    if (path === "/wallet") return send(res, 200, { data: { wallet_balance: (state.walletCents / 100).toFixed(2) } });
    if (path === "/products/all") return send(res, 200, { data: MOCK_PLANS });

    if (path === "/products/orders/request") {
      const plan = MOCK_PLANS.find((p) => p.plan_id === Number(body.plan_id));
      if (!plan) return send(res, 404, { message: "Plan not found" });
      if (plan.plan_id === 9001) return send(res, 500, { message: "Upstream error" });
      const id = `SM-${++seq}`;
      state.orders.set(id, { planId: plan.plan_id, status: "requested", iccid: null });
      return send(res, 200, { data: { order_id: id, status: "pending" } });
    }
    if (path === "/products/orders/complete") {
      const order = state.orders.get(String(body.order_id));
      if (!order || order.status !== "requested") return send(res, 400, { message: "Order cannot be completed" });
      if (order.planId === 9002) return send(res, 500, { message: "Upstream error" });
      const plan = MOCK_PLANS.find((p) => p.plan_id === order.planId)!;
      const cents = Math.round(plan.price * 100);
      if (state.walletCents < cents) return send(res, 402, { message: "Insufficient wallet balance" });
      state.walletCents -= cents;
      order.status = "completed";
      order.iccid = `89430000000000${String(seq).padStart(6, "0")}`;
      return send(res, 200, { data: { order_id: body.order_id, status: "completed" } });
    }
    if (path === "/products/orders/cancel") {
      const order = state.orders.get(String(body.order_id));
      if (!order || order.status === "cancelled") return send(res, 400, { message: "Order cannot be cancelled" });
      order.status = "cancelled";
      return send(res, 200, { data: { order_id: body.order_id, status: "cancelled" } });
    }
    const orderMatch = path.match(/^\/products\/orders\/([^/]+)$/);
    if (orderMatch) {
      const id = decodeURIComponent(orderMatch[1]!);
      const order = state.orders.get(id);
      if (!order) return send(res, 404, { message: "Order not found" });
      const showEsim = order.iccid && !state.delayedPlans.has(order.planId);
      return send(res, 200, { data: { order_id: id, status: order.status, esims: showEsim ? [esimFor(order.iccid!)] : [] } });
    }
    const esimMatch = path.match(/^\/whitelabel-dashboard\/esims\/details\/([^/]+)$/);
    if (esimMatch) {
      const iccid = decodeURIComponent(esimMatch[1]!);
      const found = [...state.orders.values()].find((o) => o.iccid === iccid);
      if (!found) return send(res, 404, { message: "eSIM not found" });
      return send(res, 200, { data: { ...esimFor(iccid), status: "installed", total_mb: 5120, used_mb: state.usedMbOverride ?? 300, expires_at: null } });
    }
    send(res, 404, { message: `No mock for ${req.method} ${path}` });
  });
  return { server, state };
}

export function newMockState(walletCents = 50_000): MockState {
  return { walletCents, orders: new Map(), calls: [], delayedPlans: new Set([9003]) };
}

function esimFor(iccid: string) {
  return { iccid, smdp_address: "smdp.mock.roambuddy.test", activation_code: `ACT-${iccid.slice(-6)}` };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
