import "server-only";
import type { BookingActorType, BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canTransition } from "./transitions";
import { dispatchLifecycleHook, type BookingHookContext } from "./hooks";
import { BookingNotFoundError, InvalidBookingTransitionError, ConcurrentBookingModificationError } from "./errors";

// Booking Lifecycle Engine — Phase E.1. THE single engine every status
// change must pass through (requirement #3, "centralize transition
// rules") — cancel-booking.ts (the only pre-existing status mutator)
// is wired through this in the same phase; any future accept/reject/
// start/complete action must go through this too, never write
// Booking.status directly.
//
// Accepts an optional external transaction client so callers that
// already wrap a status change in their own $transaction (e.g.
// cancel-booking.ts's capacity-release logic) can include this
// engine's writes atomically in that same transaction, rather than
// nesting a second, separate transaction.
//
// DELIBERATELY DOES NOT FIRE THE LIFECYCLE HOOK ITSELF: when an
// external `tx` is passed, this function has no way to know whether
// the caller's outer transaction will actually commit — firing a hook
// before that would risk announcing a transition that later rolls
// back. It returns the BookingHookContext instead; the caller is
// responsible for calling dispatchLifecycleHook(ctx) once its
// transaction has genuinely committed. transitionBookingAndFireHooks()
// below is the safe, self-contained convenience wrapper for callers
// that don't need to compose with an existing transaction.

export interface TransitionBookingParams {
  bookingId: string;
  toStatus: BookingStatus;
  actorType: BookingActorType;
  actorId?: string;
  reason?: string;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function transitionBooking(
  params: TransitionBookingParams,
  db: DbClient = prisma
): Promise<BookingHookContext> {
  const { bookingId, toStatus, actorType, actorId, reason } = params;

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, customerId: true, providerId: true, serviceId: true },
  });

  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  if (!canTransition(booking.status, toStatus)) {
    throw new InvalidBookingTransitionError(booking.status, toStatus);
  }

  // Production Blocker fix — GUARDED write, not a plain update(). The
  // where clause re-asserts the exact status this function already
  // validated against (`booking.status`), so this update can only ever
  // succeed if nothing else changed the row between our read above and
  // this write. Without this guard, two concurrent transitions on the
  // same booking (e.g. a double-click Cancel racing the expiry cron)
  // could both pass canTransition() against the same stale read and
  // both write — producing a contradictory pair of BookingStatusEvent
  // rows and, since every terminal-transition mutator releases capacity
  // in this same transaction, a double capacity release. A 0-row result
  // here means exactly that race occurred; the thrown error aborts this
  // entire $transaction (including any capacity-release statement the
  // caller already issued), so nothing is left half-applied.
  const result = await db.booking.updateMany({
    where: { id: bookingId, status: booking.status },
    data: {
      status: toStatus,
      // confirmedAt has existed since before this phase but nothing
      // ever wrote it (confirmed by a repo-wide search) — this is the
      // first real writer, filling in its already-intended meaning,
      // not a new column or a new semantic.
      ...(toStatus === "CONFIRMED" ? { confirmedAt: new Date() } : {}),
    },
  });

  if (result.count === 0) {
    throw new ConcurrentBookingModificationError(bookingId);
  }

  await db.bookingStatusEvent.create({
    data: {
      bookingId,
      fromStatus: booking.status,
      toStatus,
      actorType,
      actorId: actorId ?? null,
      reason: reason ?? null,
    },
  });

  return {
    bookingId,
    customerId: booking.customerId,
    providerId: booking.providerId,
    serviceId: booking.serviceId,
    fromStatus: booking.status,
    toStatus,
  };
}

// Convenience wrapper for callers with no existing transaction to
// compose with: opens its own transaction, and only fires the
// lifecycle hook after that transaction has actually committed.
export async function transitionBookingAndFireHooks(
  params: TransitionBookingParams
): Promise<BookingHookContext> {
  const ctx = await prisma.$transaction((tx) => transitionBooking(params, tx));
  await dispatchLifecycleHook(ctx);
  return ctx;
}
