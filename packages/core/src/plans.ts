import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { fxRates, plans, type Db, type Mode } from "@roam/db";
import { extractPlans, type RoamBuddyClient } from "@roam/roambuddy";
import type { Partner } from "./apiKeys.ts";
import { retailPriceMinor } from "./pricing.ts";
import { toApiPlan } from "./views.ts";

/** Copies RoamBuddy's catalogue for a mode into `plans`. Plans that disappeared are deactivated. */
export async function syncPlans(db: Db, rb: RoamBuddyClient, mode: Mode): Promise<{ upserted: number; deactivated: number }> {
  const found = extractPlans(await rb.products());
  if (!found.length) throw new Error("RoamBuddy returned no plans; leaving the catalogue unchanged");
  const started = new Date();

  for (const p of found) {
    const values = {
      mode,
      rbPlanId: p.rbPlanId,
      name: p.name,
      coverage: p.coverage,
      dataMb: p.dataMb,
      validityDays: p.validityDays,
      costUsdCents: p.costUsdCents,
      active: p.costUsdCents !== null,
      raw: p.raw,
      syncedAt: started,
    };
    const { mode: _mode, rbPlanId: _rbPlanId, ...changes } = values;
    await db.insert(plans).values(values).onConflictDoUpdate({ target: [plans.mode, plans.rbPlanId], set: changes });
  }
  const gone = await db
    .update(plans)
    .set({ active: false })
    .where(and(eq(plans.mode, mode), eq(plans.active, true), lt(plans.syncedAt, started)))
    .returning({ id: plans.id });
  return { upserted: found.length, deactivated: gone.length };
}

/** Active plans with this partner's price. */
export async function plansForPartner(db: Db, partner: Partner, mode: Mode, opts: { country?: string } = {}) {
  const [rate] = partner.currency === "USD" ? [{ perUsd: "1" }] : await db.select().from(fxRates).where(eq(fxRates.currency, partner.currency));
  if (!rate) return [];
  const rows = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.mode, mode),
        eq(plans.active, true),
        isNotNull(plans.costUsdCents),
        opts.country ? sql`${opts.country.toUpperCase()} = any(${plans.coverage})` : undefined,
      ),
    )
    .orderBy(plans.name);
  return rows.map((p) =>
    toApiPlan(p, {
      amountMinor: retailPriceMinor({ costUsdCents: p.costUsdCents!, markupBps: partner.markupBps, currency: partner.currency, perUsd: rate.perUsd }),
      currency: partner.currency,
    }),
  );
}
