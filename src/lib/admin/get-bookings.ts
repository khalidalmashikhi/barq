import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { BookingStatus } from "@prisma/client";

// Admin Booking list query — Phase 2.9 (Booking Foundation).
// Mirrors get-provider-bookings.ts's filters-in/paginated-result-out
// shape and its JSON-path service-name search strategy, extended to be
// unscoped (no requireProvider()/providerId restriction — an admin can
// see every Booking, not just one provider's own). Distinct from that
// query and from the customer-facing get-my-bookings.ts, neither of
// which an admin can reuse directly since both hard-scope to the
// calling user's own provider/customer profile.
//
// CUSTOMER IDENTITY — same approved product decision documented in
// get-provider-bookings.ts: no customer name field exists anywhere in
// the schema (phone-only auth, no displayName column). This DTO carries
// the raw customerId only, exactly as every other admin list DTO
// already carries raw provider/service ids — no phone number or other
// identifying field is exposed, since no existing admin query
// establishes that as a precedent and doing so here would be a new
// exposure decision this phase was not asked to make.
//
// providerId/serviceId FILTERS (additive, same defensive convention as
// get-provider-availability.ts/get-availability-slots.ts): a malformed
// UUID short-circuits to an empty result before any Prisma call, never
// a thrown error, never a silently-ignored filter.
//
// Admin Operations Platform additions (both additive, backward
// compatible — existing single-status callers are unaffected):
// `status` may now also be a BookingStatus[] (used by the admin
// overview's "Recently Cancelled" queue, which spans CANCELLED and
// REJECTED at once — the exact same two-status combination
// fold-booking-status-counts.ts already folds into one "cancelled"
// bucket elsewhere); `updatedAfter` is a plain lower-bound filter on
// `updatedAt`, used by that same queue's documented 30-day window.
// Neither field changes behavior for any existing call site, which
// never passes them.

export type BookingAdminListFilters = {
  q?: string;
  status?: BookingStatus | BookingStatus[];
  providerId?: string;
  serviceId?: string;
  updatedAfter?: Date;
  page?: number;
  pageSize?: number;
};

export type BookingAdminListItem = {
  id: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  providerId: string;
  providerName: string;
  status: string;
  seats: number;
  priceSnapshot: string | null;
  slotStartTime: Date | null;
  createdAt: Date;
};

export type BookingAdminListResult = {
  items: BookingAdminListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getBookings(filters: BookingAdminListFilters = {}): Promise<BookingAdminListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed providerId/serviceId -> empty result, same defensive
  // convention as every sibling admin list query.
  if (filters.providerId !== undefined && !isValidUuid(filters.providerId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }
  if (filters.serviceId !== undefined && !isValidUuid(filters.serviceId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

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
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.status ? { status: Array.isArray(filters.status) ? { in: filters.status } : filters.status } : {}),
    ...(filters.updatedAfter ? { updatedAt: { gte: filters.updatedAfter } } : {}),
    ...searchClause,
  };

  const [totalCount, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { service: true, provider: true, availability: true },
    }),
  ]);

  type BookingRow = {
    id: string;
    customerId: string;
    serviceId: string;
    providerId: string;
    status: string;
    seats: number;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
    provider: { businessName: unknown };
    availability: { startTime: Date } | null;
  };

  const items: BookingAdminListItem[] = (bookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    customerId: booking.customerId,
    serviceId: booking.serviceId,
    serviceName: extractLocalizedText(booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerId: booking.providerId,
    providerName:
      extractLocalizedText(booking.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    status: booking.status,
    seats: booking.seats,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
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
