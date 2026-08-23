"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { releaseVehicleReservationForBooking } from "@/lib/booking/vehicle-reservation";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Cancel booking — Engineering Sprint (Availability Engine).
//
// Uses existing CANCELLED value from BookingStatus — no new enum
// value, no schema change. Deliberately conservative: only bookings in
// CREATED or CONFIRMED can be cancelled. No cancellation-window rule
// is invented — nothing in this project's documentation specifies one.
//
// SECURITY: ownership is re-verified from the database, not trusted
// from any client-supplied claim.
//
// CAPACITY RELEASE, transactional: if the booking held a slot,
// bookedCount is decremented by exactly its seats inside the same
// transaction as the status change — GREATEST(...,0) is defensive
// against ever going negative, not something expected to trigger in
// normal operation.
//
// "Slot becomes OPEN automatically when capacity becomes available" —
// this requirement is already satisfied by design, not something extra
// to implement: state was never changed to anything else when a slot
// reached capacity (fully-booked is a computed condition, per the
// approved architecture — Entry 067), so there is no stored state to
// revert. This function intentionally does NOT touch Availability.state
// at all — only bookedCount — so a provider's own explicit BLOCKED or
// CANCELLED override (once the Provider Dashboard exists to set one)
// is never silently undone by a customer cancelling their booking.
//
// INTERNATIONALIZATION PHASE A.4: every error return is now a stable,
// locale-neutral BookingActionErrorCode, never localized text — the
// calling page resolves a code to a translated message via
// booking-error-messages.ts's mapping layer. The booking-lookup/
// cancellation logic is now wrapped in its own try/catch (previously
// unguarded) so a genuinely unexpected exception is caught and logged
// server-side only before returning the generic UNKNOWN_ERROR code,
// rather than propagating a raw, unhandled exception.

export type CancelBookingResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function cancelBooking(bookingId: string): Promise<CancelBookingResult> {
  if (!isValidUuid(bookingId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let customer;
  try {
    const auth = await requireCustomer();
    customer = auth.customer;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_CUSTOMER_PROFILE" };
    }
    throw error;
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.customerId !== customer.id) {
      return { ok: false, error: "BOOKING_NOT_FOUND" };
    }

    if (!canCancelBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_CANCELLABLE" };
    }

    const hookContext = await prisma.$transaction(async (tx) => {
      // Phase E.1: routed through the lifecycle engine's single
      // transitionBooking() entry point instead of writing
      // Booking.status directly — this is what "every status change
      // must pass through one engine" means in practice. Passed this
      // transaction's own `tx` so the status change, the
      // BookingStatusEvent row, and the capacity release below all
      // commit or roll back together, exactly as the status change and
      // capacity release already did before this phase.
      const ctx = await transitionBooking(
        { bookingId: booking.id, toStatus: "CANCELLED", actorType: "CUSTOMER", actorId: customer.id },
        tx
      );

      if (booking.availabilityId) {
        await tx.$executeRaw`
          UPDATE availabilities
          SET "bookedCount" = GREATEST("bookedCount" - ${booking.seats}, 0)
          WHERE id = ${booking.availabilityId}::uuid
        `;
      }

      // BOOKING-CONFLICT-1B — release the vehicle's physical-occupancy hold in the SAME
      // transaction as the status change and capacity release, so a cancelled booking frees
      // its vehicle window atomically. Distinct from the seat-capacity release above (a
      // different resource). Idempotent: a booking with no active reservation (a slotless
      // non-vehicle booking, a PENDING_PROVIDER cancellation that never confirmed, or a legacy
      // pre-1A confirmed booking) releases 0 rows. Never deletes; never clears vehicleId /
      // vehicleSnapshot / operationalStartAt/endAt — assignment history is retained.
      await releaseVehicleReservationForBooking(tx, booking.id, new Date());

      return ctx;
    });

    // Fired only after the transaction above has actually committed —
    // see transition-booking.ts's own comment for why this must happen
    // out here, not inside transitionBooking() itself.
    await dispatchLifecycleHook(hookContext);

    return { ok: true };
  } catch (error) {
    // Genuinely unexpected — never expose Prisma/internal exception
    // details to the client; log server-side only and return the
    // generic code. Phase D.3: routed through the shared structured
    // logger, and only error.message (never the full exception object
    // — no stack trace, no Prisma error target/values) is captured, per
    // this codebase's "no sensitive data in logs" standard.
    logger.error("cancelBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
