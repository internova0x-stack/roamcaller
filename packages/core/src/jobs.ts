// Work the worker runs on a schedule. Kept here (not in apps/worker) so tests can run it directly.

import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { esims, partners, webhookEvents, type Db, type Mode, type Tx } from "@roam/db";
import { extractUsage, extractWalletCents } from "@roam/roambuddy";
import { advanceOrder, ordersToAdvance } from "./orders.ts";
import type { RoamBuddyFor } from "./roambuddy.ts";
import { toApiEsim } from "./views.ts";
import { enqueueWebhook, MAX_WEBHOOK_ATTEMPTS, retryDelayMs, signWebhook } from "./webhooks.ts";

/** Pushes stuck orders forward (uncertain completions, late install details). */
export async function advanceStuckOrders(db: Db, rbFor: RoamBuddyFor): Promise<number> {
  const ids = await ordersToAdvance(db);
  for (const id of ids) await advanceOrder(db, rbFor, id);
  return ids.length;
}

/** Sends due webhook events. Partners without a webhook URL get their events marked delivered (nothing to send). */
export async function deliverWebhooks(db: Db, fetchImpl: typeof fetch = fetch, limit = 100): Promise<{ sent: number; failed: number }> {
  const due = await db
    .select({ event: webhookEvents, url: partners.webhookUrl, secret: partners.webhookSecret })
    .from(webhookEvents)
    .innerJoin(partners, eq(partners.id, webhookEvents.partnerId))
    .where(and(isNull(webhookEvents.deliveredAt), lte(webhookEvents.nextAttemptAt, sql`now()`), sql`${webhookEvents.attempts} < ${MAX_WEBHOOK_ATTEMPTS}`))
    .orderBy(webhookEvents.createdAt)
    .limit(limit);

  let sent = 0;
  let failed = 0;
  for (const { event, url, secret } of due) {
    if (!url || !secret) {
      await db.update(webhookEvents).set({ deliveredAt: new Date(), lastError: "partner has no webhook URL" }).where(eq(webhookEvents.id, event.id));
      continue;
    }
    const body = JSON.stringify({ id: event.id, ...(event.payload as object) });
    let error: string | null = null;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "RoamCaller-Signature": signWebhook(secret, body), "RoamCaller-Event-Id": event.id },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = (err as Error).message;
    }
    const attempts = event.attempts + 1;
    if (error) {
      failed++;
      await db
        .update(webhookEvents)
        .set({ attempts, lastError: error, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)) })
        .where(eq(webhookEvents.id, event.id));
    } else {
      sent++;
      await db.update(webhookEvents).set({ attempts, deliveredAt: new Date(), lastError: null }).where(eq(webhookEvents.id, event.id));
    }
  }
  return { sent, failed };
}

/** Share of data used that triggers `esim.data_low`. */
export const DATA_LOW_SHARE = 0.8;

/** Refreshes usage for eSIMs that haven't expired and sends data-low and expired events once each. */
export async function refreshEsims(db: Db, rbFor: RoamBuddyFor, limit = 200): Promise<number> {
  const rows = await db
    .select()
    .from(esims)
    .where(and(or(isNull(esims.expiresAt), gt(esims.expiresAt, sql`now() - interval '1 day'`)), or(isNull(esims.checkedAt), lte(esims.checkedAt, sql`now() - interval '25 minutes'`))))
    .orderBy(sql`${esims.checkedAt} nulls first`)
    .limit(limit);

  for (const e of rows) {
    let raw: unknown;
    try {
      raw = await rbFor(e.mode).esimDetails(e.iccid);
    } catch {
      continue; // try again next round
    }
    const u = extractUsage(raw);
    const expiresAt = u.expiresAt ? new Date(u.expiresAt) : null;
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(esims)
        .set({
          status: u.status ?? e.status,
          dataTotalMb: u.dataTotalMb ?? e.dataTotalMb,
          dataUsedMb: u.dataUsedMb ?? e.dataUsedMb,
          expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : e.expiresAt,
          raw,
          checkedAt: new Date(),
        })
        .where(eq(esims.iccid, e.iccid))
        .returning();
      if (!updated) return;
      const total = updated.dataTotalMb;
      const used = updated.dataUsedMb;
      if (total && used !== null && used / total >= DATA_LOW_SHARE) await onceFor(tx, updated, "esim.data_low");
      if (updated.expiresAt && updated.expiresAt.getTime() <= Date.now()) await onceFor(tx, updated, "esim.expired");
    });
  }
  return rows.length;
}

async function onceFor(tx: Tx, e: typeof esims.$inferSelect, type: "esim.data_low" | "esim.expired") {
  const [seen] = await tx
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.type, type), eq(webhookEvents.partnerId, e.partnerId), sql`${webhookEvents.payload}->'data'->>'iccid' = ${e.iccid}`))
    .limit(1);
  if (!seen) await enqueueWebhook(tx, { partnerId: e.partnerId, mode: e.mode, type, data: toApiEsim(e) });
}

/** Our RoamBuddy wallet balance in US cents, or null if it couldn't be read. */
export async function walletCents(rbFor: RoamBuddyFor, mode: Mode): Promise<number | null> {
  return extractWalletCents(await rbFor(mode).wallet());
}

