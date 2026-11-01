// Runs before every Vercel build: applies database migrations and makes sure the
// demo has what it needs. Safe to run again and again. Does nothing without DATABASE_URL.
//
// Environment:
//   DATABASE_URL       Supabase connection string (transaction pooler, port 6543)
//   DEMO_PARTNER_KEY   optional; a test key (rc_test_ + 32 letters/digits) for a demo partner
//   DEMO_PARTNER_CURRENCY  optional, default USD
//   DEMO_PARTNER_NAME      optional, default "Demo partner" (shown on the eSIM screens, e.g. "Cleva (demo)")

import { and, eq } from "drizzle-orm";
import { apiKeys, connect, fxRates, partners, runMigrations } from "@roam/db";
import { creditPartner, hashKey, roamBuddyFromEnv, syncPlans } from "@roam/core";

if (!process.env.DATABASE_URL) {
  console.log("setup-db: DATABASE_URL is not set, skipping database setup");
  process.exit(0);
}

const { db, close } = connect(undefined, { max: 1 });
try {
  await runMigrations(db);
  console.log("setup-db: migrations applied");

  // Sample exchange rate for the demo; set real rates with `pnpm fx:set`.
  await db.insert(fxRates).values({ currency: "NGN", perUsd: "1550" }).onConflictDoNothing();

  const synced = await syncPlans(db, roamBuddyFromEnv()("test"), "test");
  console.log(`setup-db: ${synced.upserted} test plans synced`);

  const key = process.env.DEMO_PARTNER_KEY;
  if (key) {
    if (!/^rc_test_[0-9A-Za-z]{32}$/.test(key)) throw new Error("DEMO_PARTNER_KEY must be rc_test_ followed by 32 letters or digits");
    const currency = (process.env.DEMO_PARTNER_CURRENCY ?? "USD").toUpperCase();
    await db.transaction(async (tx) => {
      const name = process.env.DEMO_PARTNER_NAME?.trim() || "Demo partner";
      let [partner] = await tx.select().from(partners).where(eq(partners.slug, "demo"));
      partner ??= (await tx.insert(partners).values({ name, slug: "demo", currency, markupBps: 2000 }).returning())[0]!;
      if (partner.name !== name) [partner] = await tx.update(partners).set({ name }).where(eq(partners.id, partner.id)).returning();
      const hash = hashKey(key);
      const [existing] = await tx.select().from(apiKeys).where(and(eq(apiKeys.hash, hash)));
      if (!existing) await tx.insert(apiKeys).values({ partnerId: partner.id, mode: "test", prefix: key.slice(0, 12), hash });
      // A test balance worth about $1,000 in the partner's currency, credited once.
      const amount = partner.currency === "USD" ? 100_000 : partner.currency === "NGN" ? 155_000_000 : 0;
      if (amount) await creditPartner(tx, { mode: "test", partnerId: partner.id, currency: partner.currency, amountMinor: amount, ref: "demo-initial-credit" });
    });
    console.log("setup-db: demo partner ready");
  }
} finally {
  await close();
}
