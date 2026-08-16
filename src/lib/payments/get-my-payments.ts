import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth, assertNotActiveAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { PaymentStatus } from "@prisma/client";

// My Payments query (Customer) — Payment Experience & Financial
// Operations phase. Mirrors get-my-bookings.ts's shape exactly:
// requireAuth() (not requireCustomer()) so a user with no Customer
// profile gets an honest empty list rather than a thrown 403 — a
// Payment is reached only through Booking.customerId, so no Customer
// profile means zero Payments by definition.
//
// OWNERSHIP: scoped via `booking: { customerId: customer.id }` —
// every row Prisma can return already belongs to this customer, so
// there is no separate ownership check to get wrong.
//
// NEVER RETURNED: providerReference (gateway internals) — this DTO
// simply never selects it, so there is nothing to accidentally leak.

export type MyPaymentListItem = {
  id: string;
  bookingId: string;
  serviceName: string;
  providerName: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  refundAmount: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  hasInvoice: boolean;
};

export type MyPaymentListFilters = {
  status?: PaymentStatus;
  page?: number;
  pageSize?: number;
};

export type MyPaymentListResult = {
  items: MyPaymentListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;

export async function getMyPayments(filters: MyPaymentListFilters = {}): Promise<MyPaymentListResult> {
  const { barqUser } = await requireAuth();
  // Gate A (domain-layer authorization): an ACTIVE Admin is backoffice-only and
  // must not obtain Customer payment data, even its own — enforced here at the
  // domain boundary (not only via the page redirect) so a direct call from the
  // BARQ API/iOS/Android or another server action is denied identically.
  await assertNotActiveAdmin(barqUser.id);
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  const where = {
    booking: { customerId: customer.id },
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [totalCount, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        booking: { include: { service: true, provider: true } },
        invoice: { select: { id: true } },
      },
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
    booking: { service: { name: unknown }; provider: { businessName: unknown } };
    invoice: { id: string } | null;
  };

  const items: MyPaymentListItem[] = (payments as PaymentRow[]).map((payment) => ({
    id: payment.id,
    bookingId: payment.bookingId,
    serviceName: extractLocalizedText(payment.booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName:
      extractLocalizedText(payment.booking.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    amount: String(payment.amount),
    currency: payment.currency,
    status: payment.status,
    refundAmount: payment.refundAmount !== null ? String(payment.refundAmount) : null,
    capturedAt: payment.capturedAt,
    createdAt: payment.createdAt,
    hasInvoice: payment.invoice !== null,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
