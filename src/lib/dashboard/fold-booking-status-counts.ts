import type { BookingStatus } from "@prisma/client";

// Customer Experience Platform — pure, testable status-folding helper.
//
// WHY THIS EXISTS AS ITS OWN FILE: kept separate from any database call
// so the folding rule itself (which statuses count as "active,"
// "completed," "cancelled") can be unit-tested without mocking Prisma,
// and so the rule is documented in exactly one place.
//
// ACTIVE / UPCOMING — REUSED, NOT REINVENTED: CONFIRMED + IN_PROGRESS,
// the exact same status set get-dashboard-data.ts's own
// `activeBookingsCount` has always used (see that file's Promise.all).
// This helper does not invent a broader or narrower definition.
//
// CANCELLED — DELIBERATE, DOCUMENTED CHOICE: CANCELLED + REJECTED are
// folded together. Both represent a booking that will never happen;
// this mirrors the exact same choice already made and approved for
// "Cancelled / Lost Revenue" in the Provider Billing & Earnings
// Foundation phase (get-provider-earnings.ts's STATUS_TO_BUCKET) — kept
// consistent across the two dashboards rather than inventing a second,
// different rule for the same pair of statuses.
//
// EXCLUDED FROM ANY BUCKET, INCLUDED ONLY IN total: PENDING_PROVIDER
// (still awaiting the provider's decision — neither active/confirmed
// nor cancelled), CREATED (a momentary status no booking is ever
// actually found resting in, per the booking engine's own established
// convention), DISPUTED, and EXPIRED. None of these has its own KPI
// card this phase — they are not silently dropped, they simply still
// count toward `total`, which sums every status present.
//
// MISSING STATUSES ARE ZERO, NEVER UNDEFINED: a status with no rows at
// all for this customer never appears in Prisma's groupBy result — this
// helper starts every bucket at 0 and only adds counts for statuses
// actually present, so a brand-new customer with zero bookings gets
// {total:0, active:0, completed:0, cancelled:0}, never NaN/undefined.

export type BookingStatusCountRow = { status: BookingStatus; _count: number };

export type FoldedBookingStatusCounts = {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
};

const ACTIVE_STATUSES: readonly BookingStatus[] = ["CONFIRMED", "IN_PROGRESS"];
const CANCELLED_STATUSES: readonly BookingStatus[] = ["CANCELLED", "REJECTED"];

export function foldBookingStatusCounts(rows: BookingStatusCountRow[]): FoldedBookingStatusCounts {
  let total = 0;
  let active = 0;
  let completed = 0;
  let cancelled = 0;

  for (const row of rows) {
    total += row._count;
    if (ACTIVE_STATUSES.includes(row.status)) active += row._count;
    if (row.status === "COMPLETED") completed += row._count;
    if (CANCELLED_STATUSES.includes(row.status)) cancelled += row._count;
  }

  return { total, active, completed, cancelled };
}
