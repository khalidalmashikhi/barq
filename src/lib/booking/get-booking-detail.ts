import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Booking detail query — Engineering Sprint (Booking Engine).
//
// SECURITY: returns null identically for "booking doesn't exist" and
// "booking belongs to someone else" — the calling page treats both as
// notFound(). This is a deliberate choice: confirming a specific
// booking ID exists (even while denying access to it) leaks
// information an attacker could use to enumerate valid IDs. A uniform
// 404 for both cases is the safer default; stated directly rather than
// left as an unstated implementation detail.

function extractText(value: unknown): string {
  if (value && typeof value === "object" && "ar" in value) {
    const ar = (value as { ar?: unknown }).ar;
    if (typeof ar === "string") return ar;
  }
  return "";
}

export type BookingDetail = {
  id: string;
  serviceName: string;
  providerName: string;
  status: string;
  priceSnapshot: string | null;
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
    include: { service: true, provider: true },
  });

  if (!booking) return null;

  type BookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    confirmedAt: Date | null;
    createdAt: Date;
    service: { name: unknown };
    provider: { businessName: unknown };
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
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}
