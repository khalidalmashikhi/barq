import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";
import { isValidUuid } from "@/lib/uuid";
import type { BookingStatus } from "@prisma/client";

// Provider Bookings query — Provider Dashboard Phase 1c (Bookings
// Workspace Foundation, read-only).
//
// AUTH: resolves provider.id internally via requireProvider() — never
// accepts a providerId parameter, matching the established hardened
// pattern from getProviderOverview()/getProviderServices().
//
// CUSTOMER IDENTITY — APPROVED PRODUCT DECISION: no customer name
// field exists anywhere in the schema (User/Customer have no `name`
// column — a deliberate consequence of phone-only auth). This DTO
// carries NO customer-identifying field at all: no phone, no email,
// no synthetic identifier. The UI shows a generic localized
// "Customer"/"عميل" label instead, until a real displayName field
// exists (a future schema decision, not made here).
//
// SEARCH: Service name only, reached through the Booking -> Service
// relation, using the identical JSON-path string_contains strategy
// already verified and reused (not redesigned) in
// get-provider-services.ts — no customer name/phone exists to search
// by anyway.
//
// SORT: newest only (createdAt desc, id desc tie-break) — hardcoded,
// no `sort` filter parameter, per explicit instruction to remove all
// other sort options. A single-option control would be a pointless UI
// element this project's own conventions already avoid elsewhere.
// Additional sorts are future, justified-as-needed work.
//
// ROW/FUTURE-DETAIL READINESS: every item carries `id` (the real
// Booking id), not yet wrapped in a <Link> (no /provider/bookings/[id]
// detail page exists this phase) — but structured so that page can be
// added later without restructuring this list, mirroring Phase 1b's
// identical "carry the Service ID cleanly" decision. `availabilityId`
// is also included (free, already available via the existing
// relation) since a future cross-link into the Availability Overview
// is a natural next direction — cheap to carry now, expensive to
// retrofit as a DTO-breaking change later.
//
// serviceId FILTER (Phase 2, additive): an optional, pure narrowing
// constraint on top of the already-resolved provider.id scope — see
// the identical note in get-provider-availability.ts. Malformed
// serviceId safely short-circuits to an empty result before any
// Prisma call, never a thrown error, never silently ignored.

export type ProviderBookingListFilters = {
  q?: string;
  status?: BookingStatus;
  serviceId?: string;
  page?: number;
  pageSize?: number;
};

export type ProviderBookingListItem = {
  id: string;
  serviceName: string;
  status: string;
  seats: number;
  priceSnapshot: string | null;
  slotStartTime: Date | null;
  availabilityId: string | null;
  createdAt: Date;
};

export type ProviderBookingListResult = {
  items: ProviderBookingListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;

export async function getProviderBookings(filters: ProviderBookingListFilters): Promise<ProviderBookingListResult> {
  const { provider } = await requireProvider();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed serviceId -> empty result, never a Prisma error and
  // never a silently-ignored filter — see module note above.
  if (filters.serviceId !== undefined && !isValidUuid(filters.serviceId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  // Identical JSON-path search strategy to get-provider-services.ts /
  // get-services.ts — see module note above.
  const searchClause = filters.q
    ? {
        service: {
          OR: [
            { name: { path: ["ar"], string_contains: filters.q } },
            { name: { path: ["en"], string_contains: filters.q } },
          ],
        },
      }
    : {};

  const where = {
    providerId: provider.id,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...searchClause,
  };

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
    status: string;
    seats: number;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    availabilityId: string | null;
    createdAt: Date;
    service: { name: unknown };
    availability: { startTime: Date } | null;
  };

  const items: ProviderBookingListItem[] = (bookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractText(booking.service.name) || "تجربة",
    status: booking.status,
    seats: booking.seats,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    slotStartTime: booking.availability?.startTime ?? null,
    availabilityId: booking.availabilityId,
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
