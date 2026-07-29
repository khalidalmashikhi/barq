import { describe, it, expect, vi, afterEach } from "vitest";

// Payment Experience & Financial Operations phase — regression tests
// for getProviderPayments(). Confirms: ownership scoping via
// booking.providerId, all five PaymentStatus values are preserved in
// the summary (never collapsed to Completed/Pending), currency
// separation (never merged/summed across currencies), CAPTURED/
// REFUNDED_* are never combined into one net figure, and
// providerReference is never returned.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const countMock = vi.fn();
const findManyMock = vi.fn();
const groupByMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
      groupBy: (...args: unknown[]) => groupByMock(...args),
    },
  },
}));

const { getProviderPayments } = await import("./get-provider-payments");

afterEach(() => {
  requireProviderMock.mockReset();
  getLocaleMock.mockReset();
  countMock.mockReset();
  findManyMock.mockReset();
  groupByMock.mockReset();
});

describe("getProviderPayments", () => {
  it("scopes every query through booking.providerId", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    groupByMock.mockResolvedValue([]);

    await getProviderPayments();

    expect(countMock).toHaveBeenCalledWith({ where: { booking: { providerId: "provider-1" } } });
    expect(groupByMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { booking: { providerId: "provider-1" } } })
    );
  });

  it("short-circuits to an empty result for a malformed bookingId filter, never calling Prisma", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

    const result = await getProviderPayments({ bookingId: "not-a-uuid" });

    expect(result.items).toEqual([]);
    expect(result.summary).toEqual({
      capturedByCurrency: [],
      refundedByCurrency: [],
      initiatedCount: 0,
      failedCount: 0,
    });
    expect(countMock).not.toHaveBeenCalled();
    expect(groupByMock).not.toHaveBeenCalled();
  });

  it("preserves all five PaymentStatus values in the summary — never collapsed to Completed/Pending", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    groupByMock.mockResolvedValue([
      { status: "INITIATED", currency: "OMR", _sum: { amount: 10, refundAmount: null }, _count: 1 },
      { status: "CAPTURED", currency: "OMR", _sum: { amount: 100, refundAmount: null }, _count: 2 },
      { status: "REFUNDED_PARTIAL", currency: "OMR", _sum: { amount: 20, refundAmount: 5 }, _count: 1 },
      { status: "REFUNDED_FULL", currency: "OMR", _sum: { amount: 15, refundAmount: 15 }, _count: 1 },
      { status: "FAILED", currency: "OMR", _sum: { amount: 8, refundAmount: null }, _count: 1 },
    ]);

    const result = await getProviderPayments();

    expect(result.summary.initiatedCount).toBe(1);
    expect(result.summary.failedCount).toBe(1);
    // CAPTURED contributes 100; REFUNDED_PARTIAL/REFUNDED_FULL contribute their
    // refundAmount (5 + 15 = 20) to refundedByCurrency, never merged with captured.
    expect(result.summary.capturedByCurrency).toEqual([{ amount: "100.00", currency: "OMR" }]);
    expect(result.summary.refundedByCurrency).toEqual([{ amount: "20.00", currency: "OMR" }]);
  });

  it("keeps currencies separate — never sums or converts across currencies", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    groupByMock.mockResolvedValue([
      { status: "CAPTURED", currency: "OMR", _sum: { amount: 100, refundAmount: null }, _count: 1 },
      { status: "CAPTURED", currency: "USD", _sum: { amount: 50, refundAmount: null }, _count: 1 },
    ]);

    const result = await getProviderPayments();

    expect(result.summary.capturedByCurrency).toEqual([
      { amount: "100.00", currency: "OMR" },
      { amount: "50.00", currency: "USD" },
    ]);
  });

  it("maps list rows and never returns providerReference", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    groupByMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([
      {
        id: "payment-1",
        bookingId: "booking-1",
        amount: "25.00",
        currency: "OMR",
        status: "CAPTURED",
        refundAmount: null,
        capturedAt: new Date("2026-07-20T00:00:00Z"),
        createdAt: new Date("2026-07-19T00:00:00Z"),
        booking: { service: { name: { ar: "جولة", en: "Desert Tour" } } },
        providerReference: "pi_should_never_leak",
      },
    ]);

    const result = await getProviderPayments();

    expect(result.items[0]).toEqual(
      expect.objectContaining({ id: "payment-1", serviceName: "Desert Tour", amount: "25.00", currency: "OMR" })
    );
    expect(result.items[0]).not.toHaveProperty("providerReference");
  });
});
