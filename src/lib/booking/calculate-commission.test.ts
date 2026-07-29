import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { calculateCommissionAmount } = await import("./calculate-commission");

describe("calculateCommissionAmount", () => {
  it("computes 12% for TIER_12", () => {
    expect(calculateCommissionAmount("100", "TIER_12")).toBe("12.00");
  });

  it("computes 10% for TIER_10", () => {
    expect(calculateCommissionAmount("15", "TIER_10")).toBe("1.50");
  });

  it("computes 8% for TIER_8", () => {
    expect(calculateCommissionAmount("30", "TIER_8")).toBe("2.40");
  });

  it("accepts a numeric priceAmount as well as a string", () => {
    expect(calculateCommissionAmount(50, "TIER_10")).toBe("5.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(calculateCommissionAmount("33.33", "TIER_10")).toBe("3.33");
  });

  it("matches the real seeded formula for existing data (price 15, TIER_10 -> 1.5)", () => {
    // Regression pin: this exact input/output pair is a real row already
    // seeded in the dev database (see prisma/seed.ts) — confirms this
    // function reproduces the same result the seed script hand-computed.
    expect(calculateCommissionAmount("15", "TIER_10")).toBe("1.50");
  });
});
