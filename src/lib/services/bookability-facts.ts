import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";

// Batched slot facts for the shared bookability projection — the DB half of
// ./bookability (kept separate so the pure decision helpers stay importable by client/
// server components without server-only). See ./bookability for the state semantics.

export type ServiceSlotFacts = {
  /// Service ids that are slot-based (have any non-CANCELLED Availability).
  requiresSlot: Set<string>;
  /// Service ids with ≥1 OPEN, future slot that still has a free seat.
  hasBookableSlot: Set<string>;
};

/**
 * Batched, page-scoped slot facts for many services at once — TWO bounded queries for
 * the whole page, never one per service (mirrors get-provider-services.ts's
 * idsWithUpcomingSlots pattern, extended with the same capacity − bookedCount > 0
 * truth getAvailableSlots applies so "bookable" here means genuinely bookable, not
 * merely "a slot row exists"). Invalid ids are dropped, matching the single readers.
 */
export async function getServiceSlotFacts(serviceIds: string[]): Promise<ServiceSlotFacts> {
  const ids = serviceIds.filter((id) => isValidUuid(id));
  if (ids.length === 0) return { requiresSlot: new Set(), hasBookableSlot: new Set() };

  const [declared, openFuture] = await Promise.all([
    // "Slot-based" — declarative, matching serviceRequiresSlot(): any non-CANCELLED row.
    prisma.availability.findMany({
      where: { serviceId: { in: ids }, state: { not: "CANCELLED" } },
      select: { serviceId: true },
      distinct: ["serviceId"],
    }),
    // Capacity is compared in app code (Prisma cannot compare two columns) — the exact
    // limitation getAvailableSlots documents; safe here (display projection, not a guard).
    prisma.availability.findMany({
      where: { serviceId: { in: ids }, state: "OPEN", startTime: { gt: new Date() } },
      select: { serviceId: true, capacity: true, bookedCount: true },
    }),
  ]);

  const requiresSlot = new Set(declared.map((row) => row.serviceId));
  const hasBookableSlot = new Set(
    openFuture.filter((slot) => slot.capacity - slot.bookedCount > 0).map((slot) => slot.serviceId)
  );
  return { requiresSlot, hasBookableSlot };
}
