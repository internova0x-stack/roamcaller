import { createHmac } from "node:crypto";
import { webhookEvents, type Mode, type Tx } from "@roam/db";

export type WebhookType = "order.delivered" | "order.failed" | "esim.data_low" | "esim.expired";

/** Adds an event to the outbox, inside the caller's transaction. The worker delivers it. */
export async function enqueueWebhook(tx: Tx, e: { partnerId: string; mode: Mode; type: WebhookType; data: unknown }) {
  await tx.insert(webhookEvents).values({
    partnerId: e.partnerId,
    mode: e.mode,
    type: e.type,
    payload: { type: e.type, mode: e.mode, created_at: new Date().toISOString(), data: e.data },
  });
}

/**
 * Header value partners verify: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * Documented for partners in docs/API.md.
 */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Delay before retry n (1-based): 1m, 5m, 30m, 2h, 6h, then every 12h, up to 10 attempts. */
export function retryDelayMs(attempt: number): number {
  const steps = [60, 300, 1800, 7200, 21600];
  return (steps[attempt - 1] ?? 43200) * 1000;
}

export const MAX_WEBHOOK_ATTEMPTS = 10;
