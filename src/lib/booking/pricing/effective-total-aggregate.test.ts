import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));

const queryRawMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRawMock(...args) } }));

const { aggregateEffectiveBookingTotalByCurrency, EFFECTIVE_BOOKING_TOTAL } = await import("./effective-total-aggregate");

describe("EFFECTIVE_BOOKING_TOTAL", () => {
  it("is COALESCE(bookingTotalSnapshot, priceSnapshotAmount) — the one financial-total expression", () => {
    // The SQL text carries both columns in COALESCE order (total first, then the legacy unit).
    expect(EFFECTIVE_BOOKING_TOTAL.sql).toContain("COALESCE");
    expect(EFFECTIVE_BOOKING_TOTAL.sql).toContain("bookingTotalSnapshot");
    expect(EFFECTIVE_BOOKING_TOTAL.sql).toContain("priceSnapshotAmount");
    expect(EFFECTIVE_BOOKING_TOTAL.sql.indexOf("bookingTotalSnapshot")).toBeLessThan(
      EFFECTIVE_BOOKING_TOTAL.sql.indexOf("priceSnapshotAmount")
    );
  });
});

describe("aggregateEffectiveBookingTotalByCurrency", () => {
  beforeEach(() => queryRawMock.mockReset());

  it("maps grouped rows to Decimal-safe 2dp strings and drops null-currency/null-sum rows", async () => {
    // A legacy booking (10) + a totalized booking (50) in OMR sum to 60 — never 20, never 100.
    queryRawMock.mockResolvedValue([
      { currency: "OMR", sum: new Prisma.Decimal("60"), avg: new Prisma.Decimal("30"), count: 2n },
      { currency: null, sum: new Prisma.Decimal("5"), avg: new Prisma.Decimal("5"), count: 1n },
      { currency: "USD", sum: null, avg: null, count: 0n },
    ]);

    const out = await aggregateEffectiveBookingTotalByCurrency(Prisma.sql`status = 'COMPLETED'`);

    expect(out).toEqual([{ currency: "OMR", sum: "60.00", avg: "30.00", count: 2 }]);
  });

  it("returns an empty array when there are no rows", async () => {
    queryRawMock.mockResolvedValue([]);
    expect(await aggregateEffectiveBookingTotalByCurrency(Prisma.sql`status = 'COMPLETED'`)).toEqual([]);
  });
});
