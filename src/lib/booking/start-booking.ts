"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canStartBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Start booking — Phase 4.2 ("Provider Experience," Priority 3 —
// Booking Operations). Mirrors accept-booking.ts's exact shape: "use
// server", UUID validation, requireProvider() with the same
// UnauthenticatedError/ForbiddenError handling, re-fetch-and-verify
// ownership, a named policy check, transitionBooking() inside its own
// transaction, then dispatchLifecycleHook() only after that
// transaction has committed.
//
// No capacity change — seats were already reserved at creation time
// and this transition (CONFIRMED -> IN_PROGRESS) doesn't affect them.

export type StartBookingResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function startBooking(bookingId: string): Promise<StartBookingResult> {
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

    if (!canStartBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_STARTABLE" };
    }

    const hookContext = await prisma.$transaction((tx) =>
      transitionBooking({ bookingId: booking.id, toStatus: "IN_PROGRESS", actorType: "PROVIDER", actorId: provider.id }, tx)
    );

    // Fired only after the transaction above has actually committed —
    // see transition-booking.ts's own comment for why this must happen
    // out here, not inside transitionBooking() itself.
    await dispatchLifecycleHook(hookContext);

    return { ok: true };
  } catch (error) {
    // Genuinely unexpected — never expose Prisma/internal exception
    // details to the client; log server-side only and return the
    // generic code, matching accept-booking.ts/cancel-booking.ts.
    logger.error("startBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
