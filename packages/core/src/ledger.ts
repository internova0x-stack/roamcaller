// Double-entry postings. See the ledgerEntries table in @roam/db for the rules.

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ledgerEntries, type Mode, type Tx } from "@roam/db";

export const account = {
  /** Money a partner has prepaid and can spend. */
  partner: (mode: Mode, partnerId: string) => `partner:${mode}:${partnerId}`,
  /** Money held for a partner's order that isn't delivered yet. */
  hold: (mode: Mode, partnerId: string) => `hold:${mode}:${partnerId}`,
  /** Sales to partners, in their currencies. */
  revenue: (mode: Mode) => `revenue:${mode}`,
  /** Where partner prepayments come from (their bank transfers to us). */
  funding: (mode: Mode) => `funding:${mode}`,
  /** Our prepaid RoamBuddy wallet, in USD. */
  rbWallet: (mode: Mode) => `rb_wallet:${mode}`,
  /** What eSIMs cost us, in USD. */
  cogs: (mode: Mode) => `cogs:${mode}`,
};

export interface Leg {
  account: string;
  currency: string;
  amountMinor: number;
}

export interface Posting {
  kind: string;
  ref: string;
  orderId?: string;
  memo?: string;
  legs: Leg[];
}

/**
 * Writes a balanced posting. Returns false (and writes nothing) when this
 * (kind, ref) was already posted, so callers can safely repeat a step.
 */
export async function post(tx: Tx, p: Posting): Promise<boolean> {
  if (p.legs.length < 2) throw new Error("A posting needs at least two legs");
  const totals = new Map<string, number>();
  for (const l of p.legs) {
    if (!Number.isSafeInteger(l.amountMinor)) throw new Error(`Amount must be an integer: ${l.amountMinor}`);
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amountMinor);
  }
  for (const [cur, total] of totals) if (total !== 0) throw new Error(`Posting ${p.kind}/${p.ref} is off by ${total} ${cur}`);

  const first = p.legs[0]!;
  const existing = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, first.account), eq(ledgerEntries.kind, p.kind), eq(ledgerEntries.ref, p.ref)))
    .limit(1);
  if (existing.length) return false;

  const postingId = randomUUID();
  await tx.insert(ledgerEntries).values(
    p.legs.map((l) => ({
      postingId,
      account: l.account,
      currency: l.currency,
      amountMinor: l.amountMinor,
      kind: p.kind,
      ref: p.ref,
      orderId: p.orderId,
      memo: p.memo,
    })),
  );
  return true;
}

export async function balance(tx: Tx, acct: string, currency: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, acct), eq(ledgerEntries.currency, currency)));
  return Number(row?.total ?? 0);
}

/** Credits a partner's prepaid balance, e.g. after their bank transfer lands. */
export function creditPartner(tx: Tx, a: { mode: Mode; partnerId: string; currency: string; amountMinor: number; ref: string; memo?: string }) {
  if (a.amountMinor <= 0) throw new Error("Top-up amount must be positive");
  return post(tx, {
    kind: "partner_topup",
    ref: a.ref,
    memo: a.memo,
    legs: [
      { account: account.funding(a.mode), currency: a.currency, amountMinor: -a.amountMinor },
      { account: account.partner(a.mode, a.partnerId), currency: a.currency, amountMinor: a.amountMinor },
    ],
  });
}
