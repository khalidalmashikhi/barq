// BOOKING-CONFLICT-1A — the ONE definition of "two vehicle reservations overlap", kept as
// a pure, dependency-free function so the in-memory decision and the SQL overlap predicate
// (in reserve-vehicle.ts) provably agree on the same half-open semantics.
//
// Windows are half-open [startsAt, endsAt): a reservation OCCUPIES its start instant and is
// FREE again at its end instant. Two windows overlap iff each starts strictly before the
// other ends. Touching at a boundary (aEnd === bStart) is therefore NOT an overlap — one
// booking ending exactly when the next begins is allowed (zero-minute buffer, by design).

/**
 * True iff half-open windows [aStart, aEnd) and [bStart, bEnd) intersect.
 * Boundary-touching windows (one ends exactly when the other starts) do NOT overlap.
 */
export function reservationIntervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}
