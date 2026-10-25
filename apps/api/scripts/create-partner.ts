// Creates a partner with test and live API keys.
//
//   pnpm partner:create --name "Acme Pay" --slug acme --currency NGN [--markup-bps 2000] [--test-credit 5000000]
//
// --test-credit adds a test-mode prepaid balance in minor units (5000000 = ₦50,000.00).
// The keys are printed once. Store them in a password manager and send them to the partner securely.

import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { connect, partners } from "@roam/db";
import { createApiKey, creditPartner, minorDigits } from "@roam/core";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    currency: { type: "string" },
    "markup-bps": { type: "string", default: "2000" },
    "webhook-url": { type: "string" },
    "test-credit": { type: "string" },
  },
});

if (!values.name || !values.slug || !values.currency) {
  console.error('Usage: pnpm partner:create --name "Acme Pay" --slug acme --currency NGN [--markup-bps 2000] [--webhook-url https://…] [--test-credit 5000000]');
  process.exit(1);
}
const currency = values.currency.toUpperCase();
minorDigits(currency); // throws on an unsupported currency

const { db, close } = connect();
const out = await db.transaction(async (tx) => {
  const [p] = await tx
    .insert(partners)
    .values({
      name: values.name!,
      slug: values.slug!,
      currency,
      markupBps: Number(values["markup-bps"]),
      webhookUrl: values["webhook-url"] ?? null,
      webhookSecret: values["webhook-url"] ? `whsec_${randomBytes(24).toString("hex")}` : null,
    })
    .returning();
  const testKey = await createApiKey(tx, p!.id, "test");
  const liveKey = await createApiKey(tx, p!.id, "live");
  if (values["test-credit"]) {
    await creditPartner(tx, { mode: "test", partnerId: p!.id, currency, amountMinor: Number(values["test-credit"]), ref: `initial-test-credit-${p!.id}` });
  }
  return { partner: p!, testKey, liveKey };
});
await close();

console.log(`Partner ${out.partner.name} (${out.partner.id})`);
console.log(`  Test key:  ${out.testKey}`);
console.log(`  Live key:  ${out.liveKey}`);
if (out.partner.webhookSecret) console.log(`  Webhook signing secret: ${out.partner.webhookSecret}`);
console.log("These keys are not stored and won't be shown again.");
