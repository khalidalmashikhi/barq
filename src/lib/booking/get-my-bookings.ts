import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth, assertNotActiveAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { Locale } from "@/i18n/locales";

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
  /// BOOKING-SUMMARY-RECONCILIATION — the stable machine id of the booked service.
  /// `serviceName` is localized display text and can be shared by two services, so it
  /// is never a key; this is.
  serviceId: string;
  serviceName: string;
  status: string;
  priceSnapshot: string | null;
  /// BOOKING-SUMMARY-RECONCILIATION — the slot this booking reserves, or null for a
  /// genuinely slotless booking. THE reconciliation key: createBooking()'s duplicate
  /// guard is keyed on (customerId, availabilityId, status != CANCELLED), so a client
  /// holding the availabilityId it submitted can reproduce that exact predicate rather
  /// than approximating it. `slotStartTime` cannot: nothing prevents two Availability
  /// rows sharing a service and a start time (no @@unique, no DB constraint, and no
  /// overlap guard in any of the four availability write paths).
  availabilityId: string | null;
  slotStartTime: Date | null;
  createdAt: Date;
};

/// Phase F.2 (My Bookings — Upcoming vs Past) — a real, additive
/// filter over the existing `status` column, not a new field: CREATED/
/// CONFIRMED/IN_PROGRESS are "upcoming" (still ahead of or in the
/// experience), COMPLETED/CANCELLED/DISPUTED are "past" (nothing left
/// to do). Mirrors the same JSON-path search strategy already used by
/// get-provider-bookings.ts for the `search` param.
const UPCOMING_STATUSES = ["CREATED", "CONFIRMED", "IN_PROGRESS"] as const;
const PAST_STATUSES = ["COMPLETED", "CANCELLED", "DISPUTED"] as const;

export type GetMyBookingsParams = {
  search?: string;
  when?: "upcoming" | "past";
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

// `localeOverride` (additive, optional): the authenticated /api/v1 adapter passes
// an explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getMyBookings(
  params: GetMyBookingsParams = {},
  localeOverride?: Locale
): Promise<GetMyBookingsResult> {
  const { barqUser } = await requireAuth();
  // Gate A: an ACTIVE Admin is backoffice-only — it must not read Customer
  // bookings, even its own. This read uses requireAuth() + a raw Customer query
  // (bypasses requireCustomer), and it is directly API-reachable via
  // GET /api/v1/me/bookings, so the exclusion is enforced explicitly here; the
  // /api/v1 auth wrapper maps this ForbiddenError to 403. (On the Web path an
  // active admin is redirected to /admin before ever reaching this loader.)
  await assertNotActiveAdmin(barqUser.id);
  const locale = localeOverride ?? (await getLocale());

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

  const searchClause = params.search
    ? {
        service: {
          OR: [
            { name: { path: ["ar"], string_contains: params.search } },
            { name: { path: ["en"], string_contains: params.search } },
          ],
        },
      }
    : {};

  const statusClause =
    params.when === "upcoming"
      ? { status: { in: [...UPCOMING_STATUSES] } }
      : params.when === "past"
        ? { status: { in: [...PAST_STATUSES] } }
        : {};

  const where = { customerId: customer.id, ...searchClause, ...statusClause };

  // Compound ordering for deterministic pagination: createdAt alone is
  // not guaranteed unique, so id (UUID v7 — itself time-ordered, per
  // ADR-0006) is a safe, natural tie-breaker rather than an arbitrary
  // second key.
  const [totalCount, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { service: true, availability: true },
    }),
  ]);

  type BookingRow = {
    id: string;
    // Both are SCALARS already on the Booking row — no extra query, no extra include.
    serviceId: string;
    availabilityId: string | null;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
    availability: { startTime: Date } | null;
  };

  const items = (bookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceId: booking.serviceId,
    serviceName: extractLocalizedText(booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    status: booking.status,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    // Read from the Booking scalar, NOT from `availability?.id`: the two are the same
    // value, and the scalar is the one the duplicate guard itself keys on.
    availabilityId: booking.availabilityId,
    slotStartTime: booking.availability?.startTime ?? null,
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
