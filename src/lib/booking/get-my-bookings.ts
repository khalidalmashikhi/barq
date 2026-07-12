import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";

// My Bookings query — Engineering Sprint (Booking Engine).
//
// Deliberately uses requireAuth() here, NOT requireCustomer() — a user
// with no Customer profile cannot have any bookings by definition
// (Booking.customerId is a required FK to Customer), so the correct
// experience is an honest empty list, not a thrown 403. requireCustomer()
// is used at the point booking actually requires a Customer to exist
// (create-booking.ts) — this is the softer, view-only path, per
// explicit "honest empty states" requirement.

export type MyBookingListItem = {
  id: string;
  serviceName: string;
  status: string;
  priceSnapshot: string | null;
  createdAt: Date;
};

export type GetMyBookingsParams = {
  page?: number;
  pageSize?: number;
};

export type GetMyBookingsResult = {
  items: MyBookingListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;

export async function getMyBookings(params: GetMyBookingsParams = {}): Promise<GetMyBookingsResult> {
  const { barqUser } = await requireAuth();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    // Honest empty state, unchanged from before pagination — a user
    // with no Customer profile has zero bookings by definition.
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  // Compound ordering for deterministic pagination: createdAt alone is
  // not guaranteed unique, so id (UUID v7 — itself time-ordered, per
  // ADR-0006) is a safe, natural tie-breaker rather than an arbitrary
  // second key.
  const [totalCount, bookings] = await Promise.all([
    prisma.booking.count({ where: { customerId: customer.id } }),
    prisma.booking.findMany({
      where: { customerId: customer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { service: true },
    }),
  ]);

  type BookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
  };

  const items = (bookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractText(booking.service.name) || "تجربة",
    status: booking.status,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    createdAt: booking.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
