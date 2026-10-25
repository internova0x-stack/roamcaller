// Adds money to a partner's prepaid balance after their payment lands.
//
//   pnpm partner:credit --slug acme --mode live --amount 50000000 --ref "GTB-TRF-0001"
//
// --amount is in minor units (50000000 = ₦500,000.00). --ref must be unique, e.g. the
// bank transfer reference: running the same ref twice credits only once.

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { connect, partners } from "@roam/db";
import { account, balance, creditPartner, formatMinor } from "@roam/core";

const { values } = parseArgs({
  options: { slug: { type: "string" }, mode: { type: "string" }, amount: { type: "string" }, ref: { type: "string" }, memo: { type: "string" } },
});
const mode = values.mode;
const amount = Number(values.amount);
if (!values.slug || (mode !== "test" && mode !== "live") || !Number.isSafeInteger(amount) || amount <= 0 || !values.ref) {
  console.error('Usage: pnpm partner:credit --slug acme --mode live|test --amount <minor units> --ref "<bank reference>" [--memo "…"]');
  process.exit(1);
}

const { db, close } = connect();
const [p] = await db.select().from(partners).where(eq(partners.slug, values.slug));
if (!p) {
  console.error(`No partner with slug ${values.slug}`);
  process.exit(1);
}
const posted = await db.transaction((tx) => creditPartner(tx, { mode, partnerId: p.id, currency: p.currency, amountMinor: amount, ref: values.ref!, memo: values.memo }));
const now = await balance(db, account.partner(mode, p.id), p.currency);
await close();
console.log(posted ? `Credited ${formatMinor(amount, p.currency)} ${p.currency}.` : `Reference ${values.ref} was already credited; nothing changed.`);
console.log(`${p.name} ${mode} balance: ${formatMinor(now, p.currency)} ${p.currency}`);
