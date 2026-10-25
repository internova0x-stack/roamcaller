// Retail pricing: RoamBuddy cost in USD cents → partner price in the partner's
// currency, in minor units. Integer maths only (BigInt), always rounded up so a
// rounding step can never eat the margin.

/** Decimal places of each currency's minor unit (ISO 4217). */
const MINOR_DIGITS: Record<string, number> = {
  USD: 2, NGN: 2, GHS: 2, KES: 2, EGP: 2, MAD: 2, ZAR: 2, EUR: 2, GBP: 2,
  TND: 3,
  XOF: 0, XAF: 0, UGX: 0,
};

export function minorDigits(currency: string): number {
  const d = MINOR_DIGITS[currency.toUpperCase()];
  if (d === undefined) throw new Error(`Unsupported currency ${currency}`);
  return d;
}

const RATE_SCALE = 1_000_000n;

/** "1550.25" → 1550250000n (rate × 1e6). Accepts up to 6 decimals. */
export function parseRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim());
  if (!m) throw new Error(`Invalid FX rate "${rate}"`);
  return BigInt(m[1]!) * RATE_SCALE + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export function retailPriceMinor(input: { costUsdCents: number; markupBps: number; currency: string; perUsd: string }): number {
  const { costUsdCents, markupBps, currency, perUsd } = input;
  if (!Number.isInteger(costUsdCents) || costUsdCents < 0) throw new Error("costUsdCents must be a non-negative integer");
  if (!Number.isInteger(markupBps) || markupBps < 0) throw new Error("markupBps must be a non-negative integer");
  const scale = 10n ** BigInt(minorDigits(currency));
  // price = cents/100 × (1 + bps/10000) × rate, in minor units
  const num = BigInt(costUsdCents) * BigInt(10_000 + markupBps) * parseRate(perUsd) * scale;
  const den = 100n * 10_000n * RATE_SCALE;
  return Number((num + den - 1n) / den);
}

/** 1234567 NGN minor units → "12,345.67". */
export function formatMinor(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (amountMinor / 10 ** digits).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
