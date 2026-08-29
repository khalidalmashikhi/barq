import { describe, it, expect } from "vitest";
import { resolveHeadlinePrice, type HeadlinePriceInput } from "./headline-price";

const at = (iso: string) => new Date(iso);

describe("resolveHeadlinePrice", () => {
  it("returns null when there are no active prices", () => {
    expect(resolveHeadlinePrice([])).toBeNull();
  });

  it("returns a single price as-is, never labelled 'from'", () => {
    const out = resolveHeadlinePrice([{ amount: "25.00", currency: "OMR", pricingUnit: "PER_PERSON" }]);
    expect(out).toEqual({ amount: "25.00", currency: "OMR", pricingUnit: "PER_PERSON", isFrom: false, multiCurrency: false });
  });

  it("picks the MINIMUM within a single currency and marks it 'from'", () => {
    const prices: HeadlinePriceInput[] = [
      { amount: "40", currency: "OMR", pricingUnit: "PER_DAY", createdAt: at("2026-01-01"), id: "a" },
      { amount: "15", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: at("2026-01-02"), id: "b" },
      { amount: "25", currency: "OMR", pricingUnit: "PER_TRIP", createdAt: at("2026-01-03"), id: "c" },
    ];
    const out = resolveHeadlinePrice(prices);
    expect(out).toMatchObject({ amount: "15", currency: "OMR", pricingUnit: "PER_PERSON", isFrom: true, multiCurrency: false });
  });

  it("carries the pricing unit OF the minimum row, not an arbitrary one", () => {
    const out = resolveHeadlinePrice([
      { amount: "100", currency: "OMR", pricingUnit: "PER_DAY" },
      { amount: "10", currency: "OMR", pricingUnit: "PER_PERSON" },
    ]);
    expect(out!.pricingUnit).toBe("PER_PERSON");
  });

  it("NEVER computes a cross-currency minimum: it scopes to the earliest price's currency", () => {
    // USD 5 is numerically smaller, but the earliest ACTIVE price is OMR — the headline
    // stays a real OMR price, and multiCurrency flags the integrity gap.
    const prices: HeadlinePriceInput[] = [
      { amount: "30", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: at("2026-01-01"), id: "a" },
      { amount: "20", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: at("2026-01-02"), id: "b" },
      { amount: "5", currency: "USD", pricingUnit: "PER_PERSON", createdAt: at("2026-01-03"), id: "c" },
    ];
    const out = resolveHeadlinePrice(prices);
    expect(out!.currency).toBe("OMR");
    expect(out!.amount).toBe("20"); // min WITHIN OMR, not the USD 5
    expect(out!.multiCurrency).toBe(true);
  });

  it("is deterministic across input orderings via (createdAt, id)", () => {
    const a: HeadlinePriceInput = { amount: "20", currency: "OMR", createdAt: at("2026-01-02"), id: "b" };
    const b: HeadlinePriceInput = { amount: "20", currency: "USD", createdAt: at("2026-01-01"), id: "a" };
    // Two equal amounts, different currencies; the earliest (USD, 2026-01-01) is primary
    // regardless of the order they arrive in.
    expect(resolveHeadlinePrice([a, b])!.currency).toBe("USD");
    expect(resolveHeadlinePrice([b, a])!.currency).toBe("USD");
  });

  it("accepts Decimal-like and numeric amounts", () => {
    const out = resolveHeadlinePrice([
      { amount: 30, currency: "OMR" },
      { amount: { toString: () => "12.50" } as unknown as number, currency: "OMR" },
    ]);
    expect(out!.amount).toBe("12.50");
  });
});
