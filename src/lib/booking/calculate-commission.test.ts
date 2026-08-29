import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

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

  // DOWNSTREAM MONEY ALIGNMENT — the input is the authoritative booking TOTAL, and the math is
  // Decimal (no JS float artifacts). These cases expose binary-float error under Number*rate.
  it("commissions on the booking TOTAL, not a unit (50 × 12% = 6.00)", () => {
    expect(calculateCommissionAmount("50", "TIER_12")).toBe("6.00");
  });

  it("is Decimal-exact on values that drift as JS floats", () => {
    // 10.25 * 0.12 = 1.23 exactly; 99.99 * 0.12 = 11.9988 -> 12.00 at 2dp HALF_UP.
    expect(calculateCommissionAmount("10.25", "TIER_12")).toBe("1.23");
    expect(calculateCommissionAmount("99.99", "TIER_12")).toBe("12.00");
    // 0.10 * 0.08 = 0.008 -> 0.01 (HALF_UP); the classic 0.1-float case must not leak.
    expect(calculateCommissionAmount("0.10", "TIER_8")).toBe("0.01");
  });

  it("accepts a Prisma.Decimal booking total", () => {
    expect(calculateCommissionAmount(new Prisma.Decimal("50.00"), "TIER_12")).toBe("6.00");
  });
});
