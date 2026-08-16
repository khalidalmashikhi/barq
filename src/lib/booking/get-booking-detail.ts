import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth, assertNotActiveAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { Locale } from "@/i18n/locales";

// Booking detail query — Engineering Sprint (Availability Engine).
//
// SECURITY: returns null identically for "booking doesn't exist" and
// "booking belongs to someone else" — the calling page treats both as
// notFound(). Uniform 404 avoids ID enumeration.
//
// NEW: exposes slot info (startTime, seats) when the booking
// references one — included() rather than a separate query, so this
// stays a single round trip.

export type BookingDetail = {
  id: string;
  serviceId: string;
  providerId: string;
  serviceName: string;
  providerName: string;
  status: string;
  priceSnapshot: string | null;
  seats: number;
  slotStartTime: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  /// Marketplace Completion (Review Creation Flow) — whether this
  /// booking already has a Review (Review.bookingId is @unique, so
  /// this is a plain existence check, not a count).
  hasReview: boolean;
  /// Payment Experience & Financial Operations phase — Payment.id when
  /// one exists for this booking (Payment.bookingId is @unique), so
  /// the page can link to /payments/[id] honestly; null renders an
  /// honest "no Payment yet" state instead of a broken link.
  paymentId: string | null;
};

// `localeOverride` (additive, optional): the authenticated /api/v1 adapter passes
// an explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getBookingDetail(
  bookingId: string,
  localeOverride?: Locale
): Promise<BookingDetail | null> {
  if (!isValidUuid(bookingId)) return null;

  const { barqUser } = await requireAuth();
  // Gate A: an ACTIVE Admin is backoffice-only — no Customer booking reads.
  // API-reachable via GET /api/v1/me/bookings/[id]; the /api/v1 auth wrapper
  // maps this ForbiddenError to 403. (Web callers redirect the admin to /admin
  // before reaching this loader.)
  await assertNotActiveAdmin(barqUser.id);

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) return null;

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: customer.id },
    include: { service: true, provider: true, availability: true, review: true, payment: { select: { id: true } } },
  });

  if (!booking) return null;

  type BookingRow = {
    id: string;
    serviceId: string;
    providerId: string;
    status: string;
    seats: number;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    confirmedAt: Date | null;
    createdAt: Date;
    service: { name: unknown };
    provider: { businessName: unknown };
    availability: { startTime: Date } | null;
    review: unknown;
    payment: { id: string } | null;
  };

  const row = booking as BookingRow;
  const locale = localeOverride ?? (await getLocale());

  return {
    id: row.id,
    serviceId: row.serviceId,
    providerId: row.providerId,
    serviceName: extractLocalizedText(row.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName: extractLocalizedText(row.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    status: row.status,
    priceSnapshot:
      row.priceSnapshotAmount !== null && row.priceSnapshotCurrency
        ? `${row.priceSnapshotAmount} ${row.priceSnapshotCurrency}`
        : null,
    seats: row.seats,
    slotStartTime: row.availability?.startTime ?? null,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    hasReview: row.review !== null,
    paymentId: row.payment?.id ?? null,
  };
}
