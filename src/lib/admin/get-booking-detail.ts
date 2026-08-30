import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { bookingMoneyViewFromRow, type BookingMoneyView } from "@/lib/booking/pricing/booking-money-view";

// Admin Booking detail query — Phase 2.9 (Booking Foundation). Returns
// a Booking regardless of who it belongs to, for admin management —
// distinct from the pre-existing src/lib/booking/get-booking-detail.ts,
// which is hardcoded to the calling Customer's own bookings (returns
// null for anyone else's, by design, to avoid ID enumeration on a
// customer-facing page). No such ownership restriction applies here:
// this is behind requireAdmin(), same as every sibling admin detail
// query.
//
// A Booking's full status-change history is already exposed, unscoped,
// by the pre-existing src/lib/booking/lifecycle/get-booking-timeline.ts
// (Phase E.1) — reused directly by the caller when needed, not
// duplicated or wrapped here.
//
// reviewId — Admin Operations Platform addition: Booking.review is an
// existing nullable one-to-one relation (see prisma/schema.prisma);
// exposing just its id (never rating/content here) lets the admin
// booking detail page link to the review when one exists, without
// duplicating any review-fetching logic — the Reviews admin page/
// get-reviews.ts owns the actual review data.

export type BookingAdminDetail = {
  id: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  providerId: string;
  providerName: string;
  status: string;
  seats: number;
  availabilityId: string | null;
  slotStartTime: Date | null;
  slotEndTime: Date | null;
  /// UNIT price snapshot (backward-compatible; unchanged meaning).
  priceSnapshot: string | null;
  /// BOOKING TOTAL PRESENTATION — authoritative money view. Admin needs to distinguish unit
  /// price, booking total, and commission (§18); this carries the total + breakdown, commission
  /// stays its own field below.
  bookingMoney: BookingMoneyView;
  commissionSnapshot: { amount: string; tier: string } | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reviewId: string | null;
  /// Payment Experience & Financial Operations phase — same pattern as
  /// reviewId above: Booking.payment is an existing nullable one-to-one
  /// relation, exposing just its id lets the admin booking detail page
  /// link to /admin/payments/[id] when one exists.
  paymentId: string | null;
} | null;

export async function getBookingDetail(bookingId: string): Promise<BookingAdminDetail> {
  await requireAdmin();

  if (!isValidUuid(bookingId)) {
    return null;
  }

  const locale = await getLocale();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      provider: true,
      availability: true,
      review: { select: { id: true } },
      payment: { select: { id: true } },
    },
  });

  if (!booking) {
    return null;
  }

  type BookingRow = {
    id: string;
    customerId: string;
    serviceId: string;
    providerId: string;
    status: string;
    seats: number;
    availabilityId: string | null;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    pricingUnitSnapshot: string | null;
    billableQuantitySnapshot: number | null;
    bookingTotalSnapshot: unknown;
    commissionSnapshotAmount: unknown;
    commissionSnapshotTier: string | null;
    confirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    service: { name: unknown };
    provider: { businessName: unknown };
    availability: { startTime: Date; endTime: Date } | null;
    review: { id: string } | null;
    payment: { id: string } | null;
  };

  const row = booking as BookingRow;

  return {
    id: row.id,
    customerId: row.customerId,
    serviceId: row.serviceId,
    serviceName: extractLocalizedText(row.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerId: row.providerId,
    providerName:
      extractLocalizedText(row.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    status: row.status,
    seats: row.seats,
    availabilityId: row.availabilityId,
    slotStartTime: row.availability?.startTime ?? null,
    slotEndTime: row.availability?.endTime ?? null,
    priceSnapshot:
      row.priceSnapshotAmount !== null && row.priceSnapshotCurrency
        ? `${row.priceSnapshotAmount} ${row.priceSnapshotCurrency}`
        : null,
    bookingMoney: bookingMoneyViewFromRow(row),
    commissionSnapshot:
      row.commissionSnapshotAmount !== null && row.commissionSnapshotTier
        ? { amount: String(row.commissionSnapshotAmount), tier: row.commissionSnapshotTier }
        : null,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewId: row.review?.id ?? null,
    paymentId: row.payment?.id ?? null,
  };
}
