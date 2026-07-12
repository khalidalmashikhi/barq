import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";
import { isValidUuid } from "@/lib/uuid";
import type { AvailabilitySlotState } from "@prisma/client";

// Provider Availability query — Provider Dashboard Phase 1d
// (Availability Overview, read-only foundation).
//
// AUTH: resolves provider.id internally via requireProvider() — never
// accepts a providerId parameter, matching the established hardened
// pattern from getProviderOverview()/getProviderServices()/
// getProviderBookings().
//
// BOUNDED CONTEXT PLACEMENT: Availability belongs to the Tracking
// context (schema.prisma groups it with Journey/Route under "TRACKING
// CONTEXT", not Services or Provider). This query module itself stays
// under src/lib/provider/queries/, consistent with the established
// convention for Provider's own dashboard read-models —
// getProviderOverview/getProviderServices/getProviderBookings all live
// there too, each reading data owned by a different bounded context.
// The state label/style presentation helper
// (src/lib/tracking/presentation/availability-state.ts) and the
// filter UI (src/components/tracking/provider-availability-filters.tsx)
// both live under Tracking, per explicit instruction, since those are
// genuinely Tracking-context concerns, not Provider-specific ones.
//
// DEFAULT SCOPE, PERMANENT THIS PHASE: upcoming slots only
// (startTime > now) — no past/history/all option exists, per explicit
// instruction. The filter contract simply has no such parameter today;
// a future, separately-approved addition could introduce one without
// breaking this contract, but nothing beyond the current default is
// built speculatively now.
//
// STATE FILTER: shows all 3 AvailabilitySlotState values by default
// (OPEN/BLOCKED/CANCELLED) — mirrors the same "Provider sees
// everything they own, filter narrows" rule already established for
// Services (all 4 statuses) and Bookings (all 6 statuses).
//
// SEARCH: Service name only, reached through the Availability ->
// Service relation, reusing the identical JSON-path string_contains
// strategy already verified and reused (not redesigned) in
// get-provider-services.ts and get-provider-bookings.ts.
//
// SORT: upcoming-first only (startTime asc, id asc tie-break) —
// hardcoded, no `sort` filter parameter, consistent with Phase 1c's
// established "don't build a dropdown with one meaningful choice"
// decision, applied here from the start.
//
// REMAINING SEATS — DEFENSIVE GUARD, PER EXPLICIT INSTRUCTION:
// remainingSeats is always Math.max(0, capacity - bookedCount). The
// CHECK constraint added in the availability_capacity_model migration
// (bookedCount <= capacity) should make bookedCount > capacity
// structurally impossible in practice, but this guard exists so that
// if that invariant is ever violated (a future bug, a direct database
// edit, a migration gap), this query safely displays 0 remaining
// seats rather than a negative number or a thrown error. It does NOT
// attempt to repair the underlying data — only to render whatever
// exists safely, never crashing and never exposing a negative value.
//
// ROW/FUTURE-DETAIL READINESS: every item carries `id` (the real
// Availability id) and `serviceId` — not yet wrapped in a <Link> (no
// /provider/availability/[id] detail page exists this phase), but
// structured so that page can be added later without restructuring
// this list, mirroring the identical decision already made for
// Services and Bookings. Raw `capacity`/`bookedCount` are kept
// alongside the derived `remainingSeats` since a future edit form
// will need the actual numbers, not just the computed remainder.
//
// getOmanTodayRangeUtc() IS NOT USED HERE: this phase's "upcoming"
// filter is a plain instant comparison (startTime > now), which is
// timezone-agnostic by nature — unlike Overview's "today" count, this
// query never needs an Oman calendar-day boundary, so there was no
// genuine reason to import that helper into a second module this
// phase (left in place at getProviderOverview() per explicit
// instruction, not moved).
//
// serviceId FILTER (Phase 2, additive): an optional, pure narrowing
// constraint on top of the already-resolved provider.id scope — it can
// only make the result set smaller, never wider, since providerId is
// always applied first regardless. Never accepted in place of
// providerId, never trusted as an ownership claim by itself. A
// malformed serviceId (fails isValidUuid) safely short-circuits to an
// empty result before any Prisma call is made — never a thrown Prisma
// error, never silently ignored to return the full unscoped list.
// Existing callers that omit serviceId entirely are completely
// unaffected.

export type ProviderAvailabilityFilters = {
  q?: string;
  state?: AvailabilitySlotState;
  serviceId?: string;
  page?: number;
  pageSize?: number;
};

export type ProviderAvailabilityListItem = {
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

export type ProviderAvailabilityListResult = {
  items: ProviderAvailabilityListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;

export async function getProviderAvailability(
  filters: ProviderAvailabilityFilters
): Promise<ProviderAvailabilityListResult> {
  const { provider } = await requireProvider();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed serviceId -> empty result, never a Prisma error and
  // never a silently-ignored filter — see module note above.
  if (filters.serviceId !== undefined && !isValidUuid(filters.serviceId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  // Identical JSON-path search strategy to get-provider-services.ts /
  // get-provider-bookings.ts — see module note above.
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
    service: { providerId: provider.id },
    startTime: { gt: new Date() },
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...searchClause,
  };

  const [totalCount, slots] = await Promise.all([
    prisma.availability.count({ where }),
    prisma.availability.findMany({
      where,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
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

  const items: ProviderAvailabilityListItem[] = (slots as AvailabilityRow[]).map((slot) => ({
    id: slot.id,
    serviceId: slot.serviceId,
    serviceName: extractText(slot.service.name) || "تجربة",
    startTime: slot.startTime,
    endTime: slot.endTime,
    state: slot.state,
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
    // Defensive guard against overbooked/inconsistent data — see
    // module note above. Never negative, never thrown; a stale or
    // inconsistent row degrades to "0 remaining," not a crash, and is
    // never silently "corrected" in the database by this query.
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
