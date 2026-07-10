import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// My Bookings query — Engineering Sprint (Booking Engine).
//
// Deliberately uses requireAuth() here, NOT requireCustomer() — a user
// with no Customer profile cannot have any bookings by definition
// (Booking.customerId is a required FK to Customer), so the correct
// experience is an honest empty list, not a thrown 403. requireCustomer()
// is used at the point booking actually requires a Customer to exist
// (create-booking.ts) — this is the softer, view-only path, per
// explicit "honest empty states" requirement.

function extractText(value: unknown): string {
  if (value && typeof value === "object" && "ar" in value) {
    const ar = (value as { ar?: unknown }).ar;
    if (typeof ar === "string") return ar;
  }
  return "";
}

export type MyBookingListItem = {
  id: string;
  serviceName: string;
  status: string;
  priceSnapshot: string | null;
  createdAt: Date;
};

export async function getMyBookings(): Promise<MyBookingListItem[]> {
  const { barqUser } = await requireAuth();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    return [];
  }

  const bookings = await prisma.booking.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    include: { service: true },
  });

  type BookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
  };

  return (bookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractText(booking.service.name) || "تجربة",
    status: booking.status,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    createdAt: booking.createdAt,
  }));
}
