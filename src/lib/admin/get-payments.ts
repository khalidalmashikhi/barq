import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { PaymentStatus } from "@prisma/client";

// Admin Payment list query — Phase 2.12 (Payment Foundation). Mirrors
// get-bookings.ts's filters-in/paginated-result-out shape exactly,
// including its JSON-path service-name search strategy (reached here
// through Payment -> Booking -> Service, one hop further than
// get-bookings.ts's own Booking -> Service). Read-only: no capture,
// refund, or status-mutation action exists here or anywhere else —
// those require a real Payment Gateway, explicitly out of this
// phase's scope.

export type PaymentAdminListFilters = {
  q?: string;
  status?: PaymentStatus;
  bookingId?: string;
  page?: number;
  pageSize?: number;
};

export type PaymentAdminListItem = {
  id: string;
  bookingId: string;
  serviceName: string;
  providerName: string;
  amount: string;
  currency: string;
  status: string;
  capturedAt: Date | null;
  createdAt: Date;
};

export type PaymentAdminListResult = {
  items: PaymentAdminListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getPayments(filters: PaymentAdminListFilters = {}): Promise<PaymentAdminListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed bookingId -> empty result, same defensive convention as
  // every sibling admin list query.
  if (filters.bookingId !== undefined && !isValidUuid(filters.bookingId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  const searchClause = filters.q
    ? {
        booking: {
          service: {
            OR: [
              { name: { path: ["ar"], string_contains: filters.q } },
              { name: { path: ["en"], string_contains: filters.q } },
            ],
          },
        },
      }
    : {};

  const where = {
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...searchClause,
  };

  const [totalCount, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { booking: { include: { service: true, provider: true } } },
    }),
  ]);

  type PaymentRow = {
    id: string;
    bookingId: string;
    amount: unknown;
    currency: string;
    status: string;
    capturedAt: Date | null;
    createdAt: Date;
    booking: { service: { name: unknown }; provider: { businessName: unknown } };
  };

  const items: PaymentAdminListItem[] = (payments as PaymentRow[]).map((payment) => ({
    id: payment.id,
    bookingId: payment.bookingId,
    serviceName: extractLocalizedText(payment.booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName:
      extractLocalizedText(payment.booking.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    amount: String(payment.amount),
    currency: payment.currency,
    status: payment.status,
    capturedAt: payment.capturedAt,
    createdAt: payment.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
