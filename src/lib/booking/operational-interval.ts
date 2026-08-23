import "server-only";

// BOOKING-INTERVAL-1 — the ONE validator for a booking's operational interval, so Web,
// the /api/v1 adapter, and the acceptance domain all agree on what a valid interval is and
// never duplicate the date rules. Pure: absolute Date instants in, a discriminated result
// out. Timezone normalization (Oman wall-clock → instant) happens at the edge BEFORE this
// (via omanLocalToUtc on Web, ISO parse on the API); this helper only judges instants.
//
// Half-open [startsAt, endsAt): start must be strictly before end. Absent BOTH is "no
// schedule supplied" (SCHEDULE_REQUIRED); a one-sided or malformed or start>=end pair is a
// broken schedule (INVALID_SCHEDULE). These are the two distinct provider-acceptance
// failures — deliberately NOT reusing SLOT_REQUIRED, which is the customer's create-time
// "you omitted a required Availability slot" outcome.

export type OperationalInterval = { startsAt: Date; endsAt: Date };

export type OperationalIntervalError = "SCHEDULE_REQUIRED" | "INVALID_SCHEDULE";

export type OperationalIntervalValidation =
  | { ok: true; interval: OperationalInterval }
  | { ok: false; error: OperationalIntervalError };

function isValidDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Validate a provider-supplied operational interval pair (already parsed to instants).
 * - both null/absent → SCHEDULE_REQUIRED (nothing supplied)
 * - one side missing / non-date / startsAt >= endsAt → INVALID_SCHEDULE (broken pair)
 * - startsAt < endsAt → ok
 */
export function validateOperationalInterval(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): OperationalIntervalValidation {
  const startAbsent = startsAt === null || startsAt === undefined;
  const endAbsent = endsAt === null || endsAt === undefined;

  if (startAbsent && endAbsent) return { ok: false, error: "SCHEDULE_REQUIRED" };
  if (!isValidDate(startsAt) || !isValidDate(endsAt)) return { ok: false, error: "INVALID_SCHEDULE" };
  if (startsAt.getTime() >= endsAt.getTime()) return { ok: false, error: "INVALID_SCHEDULE" };

  return { ok: true, interval: { startsAt, endsAt } };
}

/**
 * The stored-pair invariant used by readers/writes: a booking interval is well-formed iff
 * BOTH sides are null (unset/legacy) OR both are valid instants with startsAt < endsAt.
 * A one-sided or reversed pair is never a legitimate stored state.
 */
export function isWellFormedIntervalPair(startsAt: Date | null, endsAt: Date | null): boolean {
  if (startsAt === null && endsAt === null) return true;
  if (!isValidDate(startsAt) || !isValidDate(endsAt)) return false;
  return startsAt.getTime() < endsAt.getTime();
}
