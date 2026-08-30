import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import { parseBookingVehicleSnapshot, type BookingVehicleSnapshot } from "@/lib/booking/booking-vehicle-snapshot";
import { bookingMoneyViewFromRow, type BookingMoneyView } from "@/lib/booking/pricing/booking-money-view";
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

// BOOKING-VEHICLE-2 — provider hybrid: the historical snapshot fields plus the ONE live
// operational field (registrationNumber) resolved from the currently-assigned Vehicle.
export type ProviderAssignedVehicle = BookingVehicleSnapshot & { registrationNumber: string | null };

export type ProviderBookingDetail = {
  id: string;
  serviceId: string;
  serviceName: string;
  status: BookingStatus;
  seats: number;
  /// UNIT price snapshot (backward-compatible; unchanged meaning).
  priceSnapshot: string | null;
  /// BOOKING TOTAL PRESENTATION — authoritative money view (effective TOTAL + unit/basis/quantity).
  bookingMoney: BookingMoneyView;
  slotStartTime: Date | null;
  createdAt: Date;
  /// Historical assigned vehicle (snapshot) + live plate. null when unassigned/legacy/malformed
  /// (fail-closed via the strict parser). Historical fields NEVER come from the live Vehicle.
  assignedVehicle: ProviderAssignedVehicle | null;
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
    // BOOKING-VEHICLE-2 — bounded live-plate lookup on the assigned Vehicle (single detail
    // read, ownership already scoped above; only registrationNumber is selected).
    include: { service: true, availability: true, vehicle: { select: { registrationNumber: true } } },
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
    pricingUnitSnapshot: string | null;
    billableQuantitySnapshot: number | null;
    bookingTotalSnapshot: unknown;
    createdAt: Date;
    vehicleSnapshot: unknown;
    service: { name: unknown };
    availability: { startTime: Date } | null;
    vehicle: { registrationNumber: string | null } | null;
  };

  const row = booking as BookingRow;

  // Historical facts come from the snapshot ONLY; the live plate is the sole live field.
  const snapshot = parseBookingVehicleSnapshot(row.vehicleSnapshot);
  const assignedVehicle: ProviderAssignedVehicle | null = snapshot
    ? { ...snapshot, registrationNumber: row.vehicle?.registrationNumber ?? null }
    : null;

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
    bookingMoney: bookingMoneyViewFromRow(row),
    slotStartTime: row.availability?.startTime ?? null,
    createdAt: row.createdAt,
    assignedVehicle,
  };
}
