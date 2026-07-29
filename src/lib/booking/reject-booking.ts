"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canRejectBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Reject booking — Phase 4.1 ("Complete the Booking Lifecycle").
// Mirrors cancel-booking.ts's exact shape (including its capacity
// release), plus the accept-booking.ts's provider-ownership pattern.
// A rejected booking must free its reserved seats, exactly as a
// cancelled one does — the customer's declined request should not
// permanently hold capacity nobody can book.
//
// `reason` is optional, free-text, and stored on the BookingStatusEvent
// row created by transitionBooking() (an existing column, already
// surfaced by the Booking Timeline) — never displayed anywhere except
// through that timeline.

export type RejectBookingResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function rejectBooking(bookingId: string, reason?: string): Promise<RejectBookingResult> {
  if (!isValidUuid(bookingId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    const auth = await requireProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.providerId !== provider.id) {
      return { ok: false, error: "BOOKING_NOT_FOUND" };
    }

    if (!canRejectBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_PENDING" };
    }

    const hookContext = await prisma.$transaction(async (tx) => {
      const ctx = await transitionBooking(
        {
          bookingId: booking.id,
          toStatus: "REJECTED",
          actorType: "PROVIDER",
          actorId: provider.id,
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
    // generic code, matching cancel-booking.ts/create-booking.ts.
    logger.error("rejectBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
