import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { extractText } from "@/lib/i18n/extract-text";

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
  serviceName: string;
  providerName: string;
  status: string;
  priceSnapshot: string | null;
  seats: number;
  slotStartTime: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
};

export async function getBookingDetail(bookingId: string): Promise<BookingDetail | null> {
  if (!isValidUuid(bookingId)) return null;

  const { barqUser } = await requireAuth();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) return null;

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: customer.id },
    include: { service: true, provider: true, availability: true },
  });

  if (!booking) return null;

  type BookingRow = {
    id: string;
    status: string;
    seats: number;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    confirmedAt: Date | null;
    createdAt: Date;
    service: { name: unknown };
    provider: { businessName: unknown };
    availability: { startTime: Date } | null;
  };

  const row = booking as BookingRow;

  return {
    id: row.id,
    serviceName: extractText(row.service.name) || "تجربة",
    providerName: extractText(row.provider.businessName) || "مزود خدمة",
    status: row.status,
    priceSnapshot:
      row.priceSnapshotAmount !== null && row.priceSnapshotCurrency
        ? `${row.priceSnapshotAmount} ${row.priceSnapshotCurrency}`
        : null,
    seats: row.seats,
    slotStartTime: row.availability?.startTime ?? null,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}
