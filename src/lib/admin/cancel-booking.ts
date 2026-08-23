"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { releaseVehicleReservationForBooking } from "@/lib/booking/vehicle-reservation";
import { logger } from "@/lib/logger";
import type { BookingAdminActionErrorCode } from "./booking-admin-errors";

// Administrative Booking cancellation — Phase 2.9 (Booking Foundation).
// Mirrors src/lib/booking/cancel-booking.ts's and reject-booking.ts's
// exact shape (including their capacity release) — the same accepted
// precedent those two files already established for each other,
// applied to a third actor. No new transition, no new eligibility rule:
// canCancelBooking() (cancellation-policy.ts) is reused completely
// unchanged, so an admin can never cancel a booking that a customer
// couldn't already have cancelled — only WHO may invoke it changes
// (any booking, not just the caller's own).
//
// AUTHORIZATION: requireAdmin(), no ownership check — deliberately
// unlike the customer/provider actions, which re-verify
// customerId/providerId against the caller. An admin acts on any
// booking by design, same as every other admin mutation in this
// codebase (deactivatePrice, transitionAvailabilityState, etc.).
//
// AUDIT: deliberately does NOT call recordAuditEvent() — per
// record-audit-event.ts's own module comment, "Booking status changes
// remain fully covered by BookingStatusEvent — this is never called
// for those." transitionBooking() already writes a BookingStatusEvent
// row with actorType: "ADMIN" and this action's `reason`, which is
// this domain's actual audit trail (also surfaced by the pre-existing,
// unscoped getBookingTimeline()) — adding a second, redundant AuditLog
// write here would duplicate that, not extend it.
//
// CAPACITY RELEASE + NOTIFICATION: identical to cancel-booking.ts —
// bookedCount is released transactionally, and dispatchLifecycleHook()
// fires the existing, toStatus-keyed onCancelled hook, which notifies
// both the customer and the provider exactly as it does for a
// customer-initiated cancellation. No new notification kind is
// introduced; this only invokes infrastructure that already exists.

export type AdminCancelBookingResult = { ok: true } | { ok: false; error: BookingAdminActionErrorCode };

export async function cancelBooking(bookingId: string, reason?: string): Promise<AdminCancelBookingResult> {
  if (!isValidUuid(bookingId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return { ok: false, error: "BOOKING_NOT_FOUND" };
    }

    if (!canCancelBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_CANCELLABLE" };
    }

    const hookContext = await prisma.$transaction(async (tx) => {
      const ctx = await transitionBooking(
        {
          bookingId: booking.id,
          toStatus: "CANCELLED",
          actorType: "ADMIN",
          actorId: admin.id,
          reason: reason?.trim() || undefined,
        },
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
      // transaction as the status + capacity release, identical to the customer cancel path
      // (src/lib/booking/cancel-booking.ts). Idempotent (0 rows for a booking with no active
      // reservation); never deletes; never clears vehicleId / snapshot / operational interval.
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
    // generic code, matching cancel-booking.ts/reject-booking.ts.
    logger.error("adminCancelBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
