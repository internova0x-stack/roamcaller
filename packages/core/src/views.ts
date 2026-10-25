// What partners see. Internal fields (RoamBuddy ids, costs, failure details) stay out.

import { eq } from "drizzle-orm";
import { esims, orders, plans, type Tx } from "@roam/db";
import { formatMinor } from "./pricing.ts";

export interface OrderView {
  order: typeof orders.$inferSelect;
  plan: typeof plans.$inferSelect;
  esim: typeof esims.$inferSelect | null;
}

export async function getOrderView(tx: Tx, orderId: string): Promise<OrderView | null> {
  const [row] = await tx
    .select({ order: orders, plan: plans, esim: esims })
    .from(orders)
    .innerJoin(plans, eq(plans.id, orders.planId))
    .leftJoin(esims, eq(esims.orderId, orders.id))
    .where(eq(orders.id, orderId));
  return row ?? null;
}

/** "processing" covers every state between payment hold and delivery. */
function publicStatus(s: OrderView["order"]["status"]): "processing" | "delivered" | "failed" | "cancelled" {
  if (s === "delivered" || s === "failed" || s === "cancelled") return s;
  return "processing";
}

export function toApiEsim(e: NonNullable<OrderView["esim"]>) {
  return {
    object: "esim" as const,
    iccid: e.iccid,
    install: {
      lpa: e.lpa,
      smdp_address: e.smdpAddress,
      activation_code: e.activationCode,
      // One-tap install link for iOS 17.4 and later.
      ios_install_url: e.lpa ? `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(e.lpa)}` : null,
      qr_url: e.qrUrl,
    },
    status: e.status,
    data_total_mb: e.dataTotalMb,
    data_used_mb: e.dataUsedMb,
    expires_at: e.expiresAt?.toISOString() ?? null,
  };
}

export function toApiOrder(v: OrderView) {
  const { order, plan, esim } = v;
  return {
    object: "order" as const,
    id: order.id,
    status: publicStatus(order.status),
    reference: order.partnerReference,
    plan: { id: plan.id, name: plan.name },
    price: { amount_minor: order.priceMinor, currency: order.currency, display: formatMinor(order.priceMinor, order.currency) },
    esim: esim ? toApiEsim(esim) : null,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}

export function toApiPlan(plan: typeof plans.$inferSelect, price: { amountMinor: number; currency: string }) {
  return {
    object: "plan" as const,
    id: plan.id,
    name: plan.name,
    coverage: plan.coverage,
    data_mb: plan.dataMb,
    validity_days: plan.validityDays,
    price: { amount_minor: price.amountMinor, currency: price.currency, display: formatMinor(price.amountMinor, price.currency) },
  };
}
