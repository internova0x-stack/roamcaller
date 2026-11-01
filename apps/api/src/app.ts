// The Roam Caller partner API. Partners call it with `Authorization: Bearer rc_<mode>_…`.
// Docs for partners: docs/API.md.

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { esims, orders, type Db, type Mode } from "@roam/db";
import {
  account,
  authenticateKey,
  balance,
  createOrder,
  formatMinor,
  getOrderView,
  OrderError,
  plansForPartner,
  toApiEsim,
  toApiOrder,
  type Partner,
  type RoamBuddyFor,
} from "@roam/core";

declare module "fastify" {
  interface FastifyRequest {
    partner: Partner;
    mode: Mode;
  }
}

class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const uuid = z.string().uuid();

export function buildApp(deps: { db: Db; rbFor: RoamBuddyFor; logger?: boolean | object }): FastifyInstance {
  const { db, rbFor } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError || err instanceof OrderError) {
      return reply.status(err.httpStatus).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: { code: "invalid_request", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: "invalid_request", message: (err as Error).message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong on our side. Retry with the same Idempotency-Key." } });
  });

  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  app.register(
    async (v1) => {
      v1.addHook("onRequest", async (req: FastifyRequest) => {
        const header = req.headers.authorization ?? "";
        const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        const auth = key ? await authenticateKey(db, key) : null;
        if (!auth) throw new ApiError(401, "unauthorized", "Send a valid API key as `Authorization: Bearer rc_test_…` or `rc_live_…`.");
        req.partner = auth.partner;
        req.mode = auth.mode;
      });

      v1.get("/plans", async (req) => {
        const q = z.object({ country: z.string().length(2).optional() }).parse(req.query);
        return { object: "list", data: await plansForPartner(db, req.partner, req.mode, q) };
      });

      v1.get("/plans/:id", async (req) => {
        const { id } = z.object({ id: uuid }).parse(req.params);
        const plan = (await plansForPartner(db, req.partner, req.mode)).find((p) => p.id === id);
        if (!plan) throw new ApiError(404, "plan_not_found", "No active plan with this id.");
        return plan;
      });

      v1.post("/orders", async (req, reply) => {
        const idempotencyKey = z.string().min(1).max(255).safeParse(req.headers["idempotency-key"]);
        if (!idempotencyKey.success) throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header (any unique string, e.g. your transaction id).");
        const body = z.object({ plan_id: uuid, reference: z.string().max(100).optional() }).parse(req.body);
        const { orderId, replayed } = await createOrder(db, rbFor, {
          partner: req.partner,
          mode: req.mode,
          planId: body.plan_id,
          partnerReference: body.reference,
          idempotencyKey: idempotencyKey.data,
        });
        const view = await getOrderView(db, orderId);
        reply.status(replayed ? 200 : 201);
        if (replayed) reply.header("Idempotent-Replayed", "true");
        return toApiOrder(view!);
      });

      v1.get("/orders", async (req) => {
        const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
        const rows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.partnerId, req.partner.id), eq(orders.mode, req.mode)))
          .orderBy(desc(orders.createdAt))
          .limit(q.limit);
        const views = await Promise.all(rows.map((r) => getOrderView(db, r.id)));
        return { object: "list", data: views.map((v) => toApiOrder(v!)) };
      });

      v1.get("/orders/:id", async (req) => {
        const { id } = z.object({ id: uuid }).parse(req.params);
        const view = await getOrderView(db, id);
        if (!view || view.order.partnerId !== req.partner.id || view.order.mode !== req.mode) {
          throw new ApiError(404, "order_not_found", "No order with this id.");
        }
        return toApiOrder(view);
      });

      v1.get("/esims/:iccid", async (req) => {
        const { iccid } = z.object({ iccid: z.string().regex(/^\d{18,22}$/) }).parse(req.params);
        const [esim] = await db
          .select()
          .from(esims)
          .where(and(eq(esims.iccid, iccid), eq(esims.partnerId, req.partner.id), eq(esims.mode, req.mode)));
        if (!esim) throw new ApiError(404, "esim_not_found", "No eSIM with this ICCID.");
        return toApiEsim(esim);
      });

      v1.get("/balance", async (req) => {
        const { partner, mode } = req;
        const available = await balance(db, account.partner(mode, partner.id), partner.currency);
        const held = await balance(db, account.hold(mode, partner.id), partner.currency);
        return {
          object: "balance",
          currency: partner.currency,
          available: { amount_minor: available, display: formatMinor(available, partner.currency) },
          held: { amount_minor: held, display: formatMinor(held, partner.currency) },
        };
      });
    },
    { prefix: "/v1" },
  );

  return app;
}
