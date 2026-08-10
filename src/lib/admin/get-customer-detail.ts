import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { isValidUuid } from "@/lib/uuid";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Admin Customer detail query — Admin Operations Platform. Same
// "read regardless of ownership" shape as get-provider-detail.ts/
// get-booking-detail.ts — behind requireAdmin(), no ownership
// restriction (distinct from the customer-facing get-my-bookings.ts/
// get-my-reviews.ts, which hard-scope to the calling Customer's own
// id). Bounded preview lists (10 each), not the full history — this is
// an operational-inspection detail page, not a data export.

export type CustomerBookingPreviewItem = {
  id: string;
  serviceName: string;
  status: string;
  createdAt: Date;
};

export type CustomerReviewPreviewItem = {
  id: string;
  serviceName: string;
  rating: number;
  createdAt: Date;
};

export type CustomerPaymentPreviewItem = {
  id: string;
  serviceName: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: Date;
};

export type CustomerDetail = {
  id: string;
  userId: string;
  phoneNumber: string | null;
  createdAt: Date;
  bookingCount: number;
  reviewCount: number;
  paymentCount: number;
  recentBookings: CustomerBookingPreviewItem[];
  recentReviews: CustomerReviewPreviewItem[];
  recentPayments: CustomerPaymentPreviewItem[];
} | null;

const PREVIEW_LIMIT = 10;

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  await requireAdmin();

  if (!isValidUuid(customerId)) {
    return null;
  }

  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { user: { select: { phoneNumber: true } }, _count: { select: { bookings: true, reviews: true } } },
  });

  if (!customer) {
    return null;
  }

  const [bookingRows, reviewRows, paymentRows, paymentCount] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
      select: { id: true, status: true, createdAt: true, service: { select: { name: true } } },
    }),
    prisma.review.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
      include: { rating: true, booking: { select: { service: { select: { name: true } } } } },
    }),
    // Customer-scoped payments via the existing Payment -> Booking -> customerId
    // relation (no schema change). Amounts are money — returned as strings.
    prisma.payment.findMany({
      where: { booking: { customerId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
      select: { id: true, amount: true, currency: true, status: true, createdAt: true, booking: { select: { service: { select: { name: true } } } } },
    }),
    prisma.payment.count({ where: { booking: { customerId } } }),
  ]);

  type BookingRow = { id: string; status: string; createdAt: Date; service: { name: unknown } };
  type ReviewRow = { id: string; createdAt: Date; rating: { value: number } | null; booking: { service: { name: unknown } } };
  type PaymentRow = { id: string; amount: { toString(): string }; currency: string; status: string; createdAt: Date; booking: { service: { name: unknown } } };

  const recentBookings: CustomerBookingPreviewItem[] = (bookingRows as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractLocalizedText(booking.service.name, locale) || fallbackServiceName,
    status: booking.status,
    createdAt: booking.createdAt,
  }));

  const recentReviews: CustomerReviewPreviewItem[] = (reviewRows as ReviewRow[]).map((review) => ({
    id: review.id,
    serviceName: extractLocalizedText(review.booking.service.name, locale) || fallbackServiceName,
    rating: review.rating?.value ?? 0,
    createdAt: review.createdAt,
  }));

  const recentPayments: CustomerPaymentPreviewItem[] = (paymentRows as PaymentRow[]).map((payment) => ({
    id: payment.id,
    serviceName: extractLocalizedText(payment.booking.service.name, locale) || fallbackServiceName,
    amount: payment.amount.toString(),
    currency: payment.currency,
    status: payment.status,
    createdAt: payment.createdAt,
  }));

  const customerRow = customer as unknown as {
    id: string;
    userId: string;
    createdAt: Date;
    user: { phoneNumber: string | null };
    _count: { bookings: number; reviews: number };
  };

  return {
    id: customerRow.id,
    userId: customerRow.userId,
    phoneNumber: customerRow.user.phoneNumber,
    createdAt: customerRow.createdAt,
    bookingCount: customerRow._count.bookings,
    reviewCount: customerRow._count.reviews,
    paymentCount,
    recentBookings,
    recentReviews,
    recentPayments,
  };
}
