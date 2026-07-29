import { describe, it, expect, vi, afterEach } from "vitest";

// Payment Experience & Financial Operations phase — regression tests
// for getPaymentOverviewMetrics(). Confirms: every PaymentStatus is
// represented (zero-filled when absent from real data), CAPTURED and
// REFUNDED_* are never combined into a net figure, and currencies are
// never merged/converted.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const groupByMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      groupBy: (...args: unknown[]) => groupByMock(...args),
    },
  },
}));

const { getPaymentOverviewMetrics } = await import("./get-payment-overview-metrics");

afterEach(() => {
  requireAdminMock.mockReset();
  groupByMock.mockReset();
});

describe("getPaymentOverviewMetrics", () => {
  it("requires an Admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([]);

    await getPaymentOverviewMetrics();

    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("zero-fills every PaymentStatus not present in real data", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([{ status: "CAPTURED", currency: "OMR", _sum: { amount: 100, refundAmount: null }, _count: 3 }]);

    const result = await getPaymentOverviewMetrics();

    expect(result.countsByStatus).toEqual({
      INITIATED: 0,
      CAPTURED: 3,
      REFUNDED_PARTIAL: 0,
      REFUNDED_FULL: 0,
      FAILED: 0,
    });
  });

  it("never combines captured and refunded amounts into one figure", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([
      { status: "CAPTURED", currency: "OMR", _sum: { amount: 100, refundAmount: null }, _count: 2 },
      { status: "REFUNDED_FULL", currency: "OMR", _sum: { amount: 25, refundAmount: 25 }, _count: 1 },
    ]);

    const result = await getPaymentOverviewMetrics();

    expect(result.capturedByCurrency).toEqual([{ amount: "100.00", currency: "OMR" }]);
    expect(result.refundedByCurrency).toEqual([{ amount: "25.00", currency: "OMR" }]);
  });

  it("keeps currencies separate", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([
      { status: "CAPTURED", currency: "OMR", _sum: { amount: 100, refundAmount: null }, _count: 1 },
      { status: "CAPTURED", currency: "USD", _sum: { amount: 40, refundAmount: null }, _count: 1 },
    ]);

    const result = await getPaymentOverviewMetrics();

    expect(result.capturedByCurrency).toEqual([
      { amount: "100.00", currency: "OMR" },
      { amount: "40.00", currency: "USD" },
    ]);
  });
});
