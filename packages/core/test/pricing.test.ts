import { describe, expect, it } from "vitest";
import { formatMinor, parseRate, retailPriceMinor } from "../src/pricing.ts";

describe("retailPriceMinor", () => {
  it("adds the markup and converts to the partner's currency", () => {
    // $8.50 × 1.20 × ₦1,550 = ₦15,810.00
    expect(retailPriceMinor({ costUsdCents: 850, markupBps: 2000, currency: "NGN", perUsd: "1550" })).toBe(1_581_000);
  });

  it("rounds up, never down", () => {
    // $0.01 × 1.0 × 1.5 = 1.5 kobo → 2
    expect(retailPriceMinor({ costUsdCents: 1, markupBps: 0, currency: "NGN", perUsd: "1.5" })).toBe(2);
  });

  it("handles currencies without minor units (CFA franc)", () => {
    // $10 × 1.15 × 605.123456 = 6958.92 → 6959 XOF
    expect(retailPriceMinor({ costUsdCents: 1000, markupBps: 1500, currency: "XOF", perUsd: "605.123456" })).toBe(6959);
  });

  it("handles three-digit currencies (Tunisian dinar)", () => {
    // $10 × 1.0 × 3.1 = 31.000 TND
    expect(retailPriceMinor({ costUsdCents: 1000, markupBps: 0, currency: "TND", perUsd: "3.1" })).toBe(31_000);
  });

  it("rejects bad input", () => {
    expect(() => retailPriceMinor({ costUsdCents: 1.5, markupBps: 0, currency: "NGN", perUsd: "1" })).toThrow();
    expect(() => retailPriceMinor({ costUsdCents: 100, markupBps: 0, currency: "XYZ", perUsd: "1" })).toThrow();
    expect(() => parseRate("1,550")).toThrow();
  });
});

describe("formatMinor", () => {
  it("formats by the currency's minor digits", () => {
    expect(formatMinor(1_581_000, "NGN")).toBe("15,810.00");
    expect(formatMinor(6959, "XOF")).toBe("6,959");
  });
});
