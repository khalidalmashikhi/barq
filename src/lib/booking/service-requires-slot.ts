import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";

// BOOKING-SLOT-AUTHORITY — the ONE executable answer to "must this service be
// booked against a time slot?".
//
// ## WHY THIS EXISTS AT ALL
//
// Until now nothing encoded that question. Both Web and the booking engine
// behaved as though `getAvailableSlots(...).length > 0` answered it, and that is
// wrong in a way that mattered: an EMPTY list is ambiguous. It means either "this
// service has no slots and is booked without one" or "this service is slot-based
// and every slot is currently full, past, or blocked". Those are opposite product
// states, and no caller could tell them apart.
//
// Worse, the ambiguity was load-bearing on the write path. `createBooking()` only
// runs its atomic capacity guard when an `availabilityId` is present, so omitting
// one against a slot-based service created a REAL, confirmed booking that consumed
// NO capacity — unlimited overbooking, invisible to every seat count. Deriving the
// rule here and enforcing it server-side is what closes that.
//
// ## THE RULE, AND WHY IT IS NOT "currently bookable"
//
// A service requires a slot iff at least one Availability row exists for it whose
// state is not CANCELLED — regardless of whether that row is OPEN, in the past, or
// already full. This is deliberately DECLARATIVE rather than momentary: a provider
// who created availability has declared how their service is booked, and that fact
// does not stop being true the moment the last seat sells or the date passes.
//
// `getAvailableSlots()` answers a different question — "what can be booked right
// now?" — and must NOT be reused here. The two are kept as separate readers
// precisely so neither drifts into the other's meaning.
//
// CANCELLED is excluded because a cancelled slot is a withdrawn offer, not a
// declaration. BLOCKED is included: it is a temporarily unavailable slot that still
// exists.
//
// ## ACCEPTED LIMITATION (this phase)
//
// The rule is derived from provider-authored rows rather than an explicit flag, so
// if every non-CANCELLED Availability row is HARD-DELETED — possible via
// `delete-availability-slot.ts`, which only refuses when `bookedCount > 0` — the
// service becomes derivably slotless again and slot-less bookings are accepted for
// it. This is ACCEPTED for this phase and is not a regression: it is exactly the
// behaviour that exists today for such a service. Closing it properly means an
// explicit `Service.requiresSlot` column plus provider and admin surfaces, which is
// deliberately out of scope here.
//
// ## NOT AUTHORIZATION, AND NEVER CLIENT-SUPPLIED
//
// This is a booking-shape rule, not a visibility gate — callers still apply their
// own PUBLISHED / provider-APPROVED checks. And no client may ever assert it: the
// server derives it on every write, so a request that simply omits `availabilityId`
// cannot talk its way past the capacity guard.

/**
 * Whether [serviceId] must be booked against an Availability slot.
 *
 * An invalid id is `false` rather than an error: every caller already resolves the
 * service through its own authoritative gate first, so an unparseable id here can
 * only mean "no such service", and a service that does not exist declares nothing.
 */
export async function serviceRequiresSlot(serviceId: string): Promise<boolean> {
  if (!isValidUuid(serviceId)) return false;

  // `count` with `take: 1` semantics is not expressible in Prisma's count API, but
  // the (serviceId) index makes this a bounded index scan; correctness does not
  // depend on the exact number, only on whether any row exists.
  const declared = await prisma.availability.count({
    where: { serviceId, state: { not: "CANCELLED" } },
  });

  return declared > 0;
}
