import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { BookingStatus } from "@prisma/client";
import type { Locale } from "@/i18n/locales";

// Provider Booking Detail query — Provider Operations Foundation.
//
// OWNERSHIP/NOT-FOUND, MIRRORING getProviderServiceDetail()'s
// ESTABLISHED CONVENTION: validates bookingId as a UUID before ever
// querying Prisma; resolves provider.id internally via requireProvider()
// (never accepts a providerId parameter); queries by BOTH the booking
// id and the authenticated provider.id combined. Returns null uniformly
// for a malformed id, a genuinely missing booking, AND a booking
// belonging to another provider.
//
// CUSTOMER IDENTITY — SAME APPROVED PRODUCT DECISION AS
// getProviderBookings(): no customer name/phone/email field exists in
// this DTO, per that query module's own note on why no such field
// exists in the schema at all.

export type ProviderBookingDetail = {
  id: string;
  serviceId: string;
  serviceName: string;
  status: BookingStatus;
  seats: number;
  priceSnapshot: string | null;
  slotStartTime: Date | null;
  createdAt: Date;
};

// `localeOverride` (additive, optional): the /api/v1 provider adapter passes an
// explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getProviderBookingDetail(
  bookingId: string,
  localeOverride?: Locale
): Promise<ProviderBookingDetail | null> {
  if (!isValidUuid(bookingId)) return null;

  const { provider } = await requireProvider();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, providerId: provider.id },
    include: { service: true, availability: true },
  });

  if (!booking) return null;

  const locale = localeOverride ?? (await getLocale());

  type BookingRow = {
    id: string;
    serviceId: string;
    status: BookingStatus;
    seats: number;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
    availability: { startTime: Date } | null;
  };

  const row = booking as BookingRow;

  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: extractLocalizedText(row.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    status: row.status,
    seats: row.seats,
    priceSnapshot:
      row.priceSnapshotAmount !== null && row.priceSnapshotCurrency
        ? `${row.priceSnapshotAmount} ${row.priceSnapshotCurrency}`
        : null,
    slotStartTime: row.availability?.startTime ?? null,
    createdAt: row.createdAt,
  };
}
