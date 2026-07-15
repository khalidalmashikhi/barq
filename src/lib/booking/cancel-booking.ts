"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
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

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: "CANCELLED" },
      });

      if (booking.availabilityId) {
        await tx.$executeRaw`
          UPDATE availabilities
          SET "bookedCount" = GREATEST("bookedCount" - ${booking.seats}, 0)
          WHERE id = ${booking.availabilityId}::uuid
        `;
      }
    });

    return { ok: true };
  } catch (error) {
    // Genuinely unexpected — never expose Prisma/internal exception
    // details to the client; log server-side only and return the
    // generic code.
    console.error("[cancelBooking] unexpected error", error);
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
