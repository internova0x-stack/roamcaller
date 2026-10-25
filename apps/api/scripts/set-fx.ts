// Sets the exchange rate used for a partner currency: units per 1 USD.
//
//   pnpm fx:set NGN 1550.50
//
// Prices are computed from it at order time, so a new rate applies to the next order.

import { connect, fxRates } from "@roam/db";
import { minorDigits, parseRate } from "@roam/core";

const [currency, rate] = process.argv.slice(2);
if (!currency || !rate) {
  console.error("Usage: pnpm fx:set <CURRENCY> <units per USD>   e.g. pnpm fx:set NGN 1550.50");
  process.exit(1);
}
const cur = currency.toUpperCase();
minorDigits(cur);
parseRate(rate);

const { db, close } = connect();
await db.insert(fxRates).values({ currency: cur, perUsd: rate }).onConflictDoUpdate({ target: fxRates.currency, set: { perUsd: rate, updatedAt: new Date() } });
await close();
console.log(`1 USD = ${rate} ${cur}`);
