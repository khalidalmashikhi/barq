import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import type { PaymentStatus } from "@prisma/client";

// Admin Payment Overview metrics — Payment Experience & Financial
// Operations phase. Approved scope (Section 11): Payment records by
// status, captured amounts by currency, refunded amounts by currency,
// failed/initiated counts — nothing else. This is NOT accounting,
// settlement, or revenue reconciliation: it never reads
// Booking.priceSnapshotAmount (that is get-provider-earnings.ts's own,
// separate data source), never merges CAPTURED and REFUNDED_* values
// into a net figure, and never converts across currencies.

export type CurrencyAmount = { amount: string; currency: string };

export type PaymentOverviewMetrics = {
  countsByStatus: Record<PaymentStatus, number>;
  capturedByCurrency: CurrencyAmount[];
  refundedByCurrency: CurrencyAmount[];
};

const ZERO_COUNTS: Record<PaymentStatus, number> = {
  INITIATED: 0,
  CAPTURED: 0,
  REFUNDED_PARTIAL: 0,
  REFUNDED_FULL: 0,
  FAILED: 0,
};

export async function getPaymentOverviewMetrics(): Promise<PaymentOverviewMetrics> {
  await requireAdmin();

  const groups = await prisma.payment.groupBy({
    by: ["status", "currency"],
    _sum: { amount: true, refundAmount: true },
    _count: true,
  });

  const countsByStatus: Record<PaymentStatus, number> = { ...ZERO_COUNTS };
  const capturedTotals = new Map<string, number>();
  const refundedTotals = new Map<string, number>();

  for (const group of groups) {
    countsByStatus[group.status] += group._count;

    if (group.status === "CAPTURED") {
      const current = capturedTotals.get(group.currency) ?? 0;
      capturedTotals.set(group.currency, current + Number(group._sum.amount ?? 0));
    } else if (group.status === "REFUNDED_PARTIAL" || group.status === "REFUNDED_FULL") {
      const current = refundedTotals.get(group.currency) ?? 0;
      refundedTotals.set(group.currency, current + Number(group._sum.refundAmount ?? 0));
    }
  }

  const toSortedCurrencyAmounts = (totals: Map<string, number>): CurrencyAmount[] =>
    Array.from(totals.entries())
      .map(([currency, amount]) => ({ amount: amount.toFixed(2), currency }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    countsByStatus,
    capturedByCurrency: toSortedCurrencyAmounts(capturedTotals),
    refundedByCurrency: toSortedCurrencyAmounts(refundedTotals),
  };
}
