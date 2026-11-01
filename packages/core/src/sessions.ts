// Hosted eSIM screens: a partner's server creates a short-lived session for one of
// its users and opens the returned URL in its app. The screens act for that partner
// and that user only, and expire after SESSION_TTL_MINUTES.

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { embedSessions, orders, partners, type Db, type Mode, type Tx } from "@roam/db";
import { hashKey, type Partner } from "./apiKeys.ts";
import { getOrderView, type OrderView } from "./views.ts";

export const SESSION_TTL_MINUTES = 120;

export type EmbedSession = typeof embedSessions.$inferSelect;

/** Creates a session and returns its token (shown once) and expiry. */
export async function createEmbedSession(
  tx: Tx,
  a: { partnerId: string; mode: Mode; customerRef: string; ttlMinutes?: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = `es_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + (a.ttlMinutes ?? SESSION_TTL_MINUTES) * 60_000);
  await tx.insert(embedSessions).values({ partnerId: a.partnerId, mode: a.mode, customerRef: a.customerRef, tokenHash: hashKey(token), expiresAt });
  return { token, expiresAt };
}

/** The session and partner behind a token, or null if it's unknown, expired or the partner is paused. */
export async function resolveEmbedSession(db: Tx, token: string | undefined | null): Promise<{ session: EmbedSession; partner: Partner } | null> {
  if (!token || !/^es_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const [row] = await db
    .select({ session: embedSessions, partner: partners })
    .from(embedSessions)
    .innerJoin(partners, eq(partners.id, embedSessions.partnerId))
    .where(and(eq(embedSessions.tokenHash, hashKey(token)), gt(embedSessions.expiresAt, new Date())));
  if (!row || row.partner.status !== "active") return null;
  return row;
}

/** A traveller's orders with this partner, newest first. */
export async function customerOrders(db: Db, a: { partnerId: string; mode: Mode; customerRef: string }, limit = 50): Promise<OrderView[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.partnerId, a.partnerId), eq(orders.mode, a.mode), eq(orders.customerRef, a.customerRef)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  const views = await Promise.all(rows.map((r) => getOrderView(db, r.id)));
  return views.filter((v): v is OrderView => v !== null);
}
