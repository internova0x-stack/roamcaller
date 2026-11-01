"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createOrder, OrderError, resolveEmbedSession } from "@roam/core";
import { getCore, sweep } from "../../lib/backend";

/** Buys a plan for the session's traveller, then shows the install screen. */
export async function buyPlan(formData: FormData): Promise<void> {
  const token = String(formData.get("t") ?? "");
  const planId = String(formData.get("plan_id") ?? "");
  const idem = String(formData.get("idem") ?? "");
  const q = `t=${encodeURIComponent(token)}`;

  const { db, rbFor } = getCore();
  const found = await resolveEmbedSession(db, token);
  if (!found) redirect(`/esim?${q}`);
  const { session, partner } = found;

  let orderId: string;
  try {
    ({ orderId } = await createOrder(db, rbFor, {
      partner,
      mode: session.mode,
      planId,
      customerRef: session.customerRef,
      // One key per page view: a double tap or a retry returns the same order.
      idempotencyKey: `embed:${idem}`,
    }));
  } catch (err) {
    const code = err instanceof OrderError ? err.code : "internal_error";
    if (!(err instanceof OrderError)) console.error("esim: order failed", err);
    redirect(`/esim/plan/${planId}?${q}&error=${code}`);
  }
  // Tell the partner (order.delivered webhook) once the page has moved on.
  after(() => sweep(true).catch((e) => console.error("sweep failed", e)));
  redirect(`/esim/order/${orderId}?${q}`);
}
