import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { AvailabilitySlotState } from "@prisma/client";

// Admin Availability list query — Phase 2.7 (Availability Foundation).
// Mirrors get-services.ts's/get-prices.ts's filters-in/paginated-
// result-out shape. Distinct from the pre-existing
// src/lib/provider/queries/get-provider-availability.ts, which is
// scoped to the calling provider's own services and hardcoded to
// upcoming slots only (startTime > now) — deliberate choices for a
// provider's own dashboard relevance, not business rules. This admin
// query intentionally shows every slot regardless of provider or time
// (past included), since admin management/audit needs full visibility,
// not just what's operationally relevant right now. Reuses the same
// JSON-path search-by-service-name strategy already proven there.

export type AvailabilitySlotListItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  state: string;
  capacity: number;
  bookedCount: number;
  remainingSeats: number;
};

export type AvailabilitySlotListFilters = {
  q?: string;
  serviceId?: string;
  state?: AvailabilitySlotState;
  page?: number;
  pageSize?: number;
};

export type AvailabilitySlotListResult = {
  items: AvailabilitySlotListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getAvailabilitySlots(filters: AvailabilitySlotListFilters = {}): Promise<AvailabilitySlotListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed serviceId -> empty result, same defensive convention as
  // get-provider-availability.ts: never a thrown Prisma error, never a
  // silently-ignored filter.
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
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...searchClause,
  };

  const [totalCount, slots] = await Promise.all([
    prisma.availability.count({ where }),
    prisma.availability.findMany({
      where,
      orderBy: [{ startTime: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { service: true },
    }),
  ]);

  type AvailabilityRow = {
    id: string;
    serviceId: string;
    startTime: Date;
    endTime: Date;
    state: string;
    capacity: number;
    bookedCount: number;
    service: { name: unknown };
  };

  const items: AvailabilitySlotListItem[] = (slots as AvailabilityRow[]).map((slot) => ({
    id: slot.id,
    serviceId: slot.serviceId,
    serviceName: extractLocalizedText(slot.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    startTime: slot.startTime,
    endTime: slot.endTime,
    state: slot.state,
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
    // Same defensive guard as get-provider-availability.ts: never
    // negative, never thrown.
    remainingSeats: Math.max(0, slot.capacity - slot.bookedCount),
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
