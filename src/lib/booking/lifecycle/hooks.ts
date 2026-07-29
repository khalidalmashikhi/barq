import "server-only";
import type { BookingStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { notifyBookingEvent, resolveBookingParties } from "./notify";

// Booking Lifecycle Engine — Phase E.1. Extension points for future
// modules to attach behavior to a lifecycle transition, without that
// future module needing to touch transition-booking.ts or the
// transition matrix itself. Every hook body is a self-contained change —
// never a signature or call-site change.
//
// Phase 4.1 ("Complete the Booking Lifecycle") gave four of these real
// bodies (previously all empty stubs): onPendingProvider (new),
// onAccepted, onRejected (new), onCancelled all now call
// notifyBookingEvent() — see notify.ts. This is safe by construction:
// dispatchLifecycleHook() (below) is only ever invoked by
// transition-booking.ts after its enclosing transaction has already
// committed, so no notification can fire for a rolled-back transition.
//
// onAccepted() remains the FUTURE CONTRACT-GENERATION EXTENSION POINT
// (a future phase's "generate contract on acceptance" logic is a single
// call added inside onAccepted() below, alongside the notification).

export interface BookingHookContext {
  bookingId: string;
  customerId: string;
  providerId: string;
  serviceId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
}

export async function onPendingProvider(ctx: BookingHookContext): Promise<void> {
  const { providerUserId } = await resolveBookingParties(ctx.bookingId);
  await notifyBookingEvent({ userId: providerUserId, bookingId: ctx.bookingId, kind: "PENDING_PROVIDER" });
}

export async function onAccepted(ctx: BookingHookContext): Promise<void> {
  const { customerUserId, providerUserId } = await resolveBookingParties(ctx.bookingId);
  await notifyBookingEvent({ userId: customerUserId, bookingId: ctx.bookingId, kind: "BOOKING_ACCEPTED" });
  // Provider Notifications & Operational Alerts phase: acceptBooking()
  // is a provider-initiated action (requireProvider()-gated) that
  // previously left no trace in the provider's own Notification Center
  // — this is their own confirmation receipt, not a duplicate of the
  // customer-facing BOOKING_ACCEPTED above.
  await notifyBookingEvent({ userId: providerUserId, bookingId: ctx.bookingId, kind: "PROVIDER_BOOKING_CONFIRMED" });
  // Future extension point: contract generation, provider payout
  // scheduling, etc.
}

export async function onRejected(ctx: BookingHookContext): Promise<void> {
  const { customerUserId, providerUserId } = await resolveBookingParties(ctx.bookingId);
  await notifyBookingEvent({ userId: customerUserId, bookingId: ctx.bookingId, kind: "BOOKING_REJECTED" });
  // Provider Notifications & Operational Alerts phase — same rationale
  // as onAccepted's own PROVIDER_BOOKING_CONFIRMED above.
  await notifyBookingEvent({ userId: providerUserId, bookingId: ctx.bookingId, kind: "PROVIDER_BOOKING_REJECTED" });
}

export async function onInProgress(ctx: BookingHookContext): Promise<void> {
  void ctx; // Future extension point: journey/tracking activation, etc.
}

export async function onCompleted(ctx: BookingHookContext): Promise<void> {
  void ctx; // Future extension point: invoice generation, review request, etc.
}

export async function onCancelled(ctx: BookingHookContext): Promise<void> {
  const { customerUserId, providerUserId } = await resolveBookingParties(ctx.bookingId);
  await notifyBookingEvent({ userId: customerUserId, bookingId: ctx.bookingId, kind: "BOOKING_CANCELLED" });
  // Phase 4.2 (Priority 5 — Notifications): cancel-booking.ts is a
  // customer-only action (see its own requireCustomer() gate) — the
  // provider previously had no way to learn a confirmed booking on
  // their calendar had just been cancelled short of manually checking.
  await notifyBookingEvent({ userId: providerUserId, bookingId: ctx.bookingId, kind: "BOOKING_CANCELLED_BY_CUSTOMER" });
  // Future extension point: refund processing, etc.
}

export async function onDisputed(ctx: BookingHookContext): Promise<void> {
  void ctx; // Future extension point: support ticket creation, etc.
}

// Phase 5.1 (Production Readiness) — fired by expire-stale-bookings.ts
// when a PENDING_PROVIDER booking's Availability slot's startTime has
// already passed with no provider response. Notifies both parties
// (same dual-notify shape as onCancelled above) since neither one
// caused this outcome — the customer needs to know their request
// won't be fulfilled, the provider needs to know they missed it.
export async function onExpired(ctx: BookingHookContext): Promise<void> {
  const { customerUserId, providerUserId } = await resolveBookingParties(ctx.bookingId);
  await notifyBookingEvent({ userId: customerUserId, bookingId: ctx.bookingId, kind: "BOOKING_EXPIRED" });
  await notifyBookingEvent({ userId: providerUserId, bookingId: ctx.bookingId, kind: "BOOKING_EXPIRED" });
}

export type HookRegistry = Partial<Record<BookingStatus, (ctx: BookingHookContext) => Promise<void>>>;

export const HOOKS: HookRegistry = {
  PENDING_PROVIDER: onPendingProvider,
  CONFIRMED: onAccepted,
  IN_PROGRESS: onInProgress,
  COMPLETED: onCompleted,
  CANCELLED: onCancelled,
  REJECTED: onRejected,
  DISPUTED: onDisputed,
  EXPIRED: onExpired,
};

// Invoked by transitionBooking() after its database transaction has
// already committed. Best-effort and isolated: a hook throwing (today
// impossible, since every hook is an empty stub — but a future hook
// calling a real external service could fail) must never undo or
// appear to undo a transition that has already been durably persisted,
// so any failure here is logged, not propagated.
//
// The `registry` parameter defaults to the real HOOKS map above and
// exists so tests can inject a stand-in registry (a same-module
// `vi.spyOn` on the named onXxx exports does not affect this
// function's internal calls, since those are direct, same-module
// bindings — this parameter is the straightforward alternative) rather
// than to support any real runtime use of a different registry.
export async function dispatchLifecycleHook(ctx: BookingHookContext, registry: HookRegistry = HOOKS): Promise<void> {
  const hook = registry[ctx.toStatus];
  if (!hook) return;

  try {
    await hook(ctx);
  } catch (error) {
    logger.error("booking.lifecycle_hook_failed", {
      bookingId: ctx.bookingId,
      toStatus: ctx.toStatus,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}
