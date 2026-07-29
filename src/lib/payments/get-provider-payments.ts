import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { PaymentStatus } from "@prisma/client";

// Provider Payments query — Payment Experience & Financial Operations
// phase. Mirrors get-payments.ts's (admin) filters-in/paginated-result-
// out shape, scoped to the authenticated Provider via
// `booking: { providerId }`.
//
// SEPARATE FROM EARNINGS, NEVER MERGED: this reads real Payment rows
// (capture/refund status) — a completely different data source from
// get-provider-earnings.ts's Booking-snapshot-derived operational
// estimate. Both may be shown side by side on /provider/earnings, but
// this module never reads Booking.priceSnapshotAmount and
// get-provider-earnings.ts is never modified to read Payment. See this
// phase's own approved boundary (Section 9).
//
// SUMMARY IS UNFILTERED BY DESIGN: `summary` always reflects every
// Payment this provider has, regardless of the current status/bookingId
// filter applied to `items` — so the at-a-glance cards stay stable
// while the list below them is narrowed. One extra groupBy query, no
// N+1.
//
// CURRENCY SEPARATION: capturedByCurrency/refundedByCurrency are each
// CurrencyAmount[] arrays, one entry per currency actually present —
// never summed or converted across currencies.
//
// NEVER RETURNED: providerReference (gateway internals).

export type CurrencyAmount = { amount: string; currency: string };

export type ProviderPaymentListItem = {
  id: string;
  bookingId: string;
  serviceName: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  refundAmount: string | null;
  capturedAt: Date | null;
  createdAt: Date;
};

export type ProviderPaymentSummary = {
  capturedByCurrency: CurrencyAmount[];
  refundedByCurrency: CurrencyAmount[];
  initiatedCount: number;
  failedCount: number;
};

export type ProviderPaymentListFilters = {
  status?: PaymentStatus;
  bookingId?: string;
  page?: number;
  pageSize?: number;
};

export type ProviderPaymentListResult = {
  items: ProviderPaymentListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: ProviderPaymentSummary;
};

const DEFAULT_PAGE_SIZE = 20;

const EMPTY_SUMMARY: ProviderPaymentSummary = {
  capturedByCurrency: [],
  refundedByCurrency: [],
  initiatedCount: 0,
  failedCount: 0,
};

export async function getProviderPayments(filters: ProviderPaymentListFilters = {}): Promise<ProviderPaymentListResult> {
  const { provider } = await requireProvider();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  if (filters.bookingId !== undefined && !isValidUuid(filters.bookingId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1, summary: EMPTY_SUMMARY };
  }

  const where = {
    booking: { providerId: provider.id },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
  };

  const [totalCount, payments, statusGroups] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { booking: { include: { service: true } } },
    }),
    prisma.payment.groupBy({
      by: ["status", "currency"],
      where: { booking: { providerId: provider.id } },
      _sum: { amount: true, refundAmount: true },
      _count: true,
    }),
  ]);

  type PaymentRow = {
    id: string;
    bookingId: string;
    amount: unknown;
    currency: string;
    status: PaymentStatus;
    refundAmount: unknown;
    capturedAt: Date | null;
    createdAt: Date;
    booking: { service: { name: unknown } };
  };

  const items: ProviderPaymentListItem[] = (payments as PaymentRow[]).map((payment) => ({
    id: payment.id,
    bookingId: payment.bookingId,
    serviceName: extractLocalizedText(payment.booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    amount: String(payment.amount),
    currency: payment.currency,
    status: payment.status,
    refundAmount: payment.refundAmount !== null ? String(payment.refundAmount) : null,
    capturedAt: payment.capturedAt,
    createdAt: payment.createdAt,
  }));

  const capturedTotals = new Map<string, number>();
  const refundedTotals = new Map<string, number>();
  let initiatedCount = 0;
  let failedCount = 0;

  for (const group of statusGroups) {
    if (group.status === "CAPTURED") {
      const current = capturedTotals.get(group.currency) ?? 0;
      capturedTotals.set(group.currency, current + Number(group._sum.amount ?? 0));
    } else if (group.status === "REFUNDED_PARTIAL" || group.status === "REFUNDED_FULL") {
      const current = refundedTotals.get(group.currency) ?? 0;
      refundedTotals.set(group.currency, current + Number(group._sum.refundAmount ?? 0));
    } else if (group.status === "INITIATED") {
      initiatedCount += group._count;
    } else if (group.status === "FAILED") {
      failedCount += group._count;
    }
  }

  const toSortedCurrencyAmounts = (totals: Map<string, number>): CurrencyAmount[] =>
    Array.from(totals.entries())
      .map(([currency, amount]) => ({ amount: amount.toFixed(2), currency }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    summary: {
      capturedByCurrency: toSortedCurrencyAmounts(capturedTotals),
      refundedByCurrency: toSortedCurrencyAmounts(refundedTotals),
      initiatedCount,
      failedCount,
    },
  };
}
