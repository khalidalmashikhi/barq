"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canEditFulfillmentInstructions } from "@/lib/booking/cancellation-policy";
import {
  parseFulfillmentInstructionsForm,
  fulfillmentInstructionsWrite,
} from "@/lib/booking/fulfillment-instructions";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// BOOKING FULFILLMENT LOGISTICS — the provider sets/edits/clears booking-SPECIFIC meeting/pickup
// instructions AFTER acceptance. Mirrors start-booking.ts's exact shape: "use server", UUID
// validation, requireProvider() with the same UnauthenticatedError/ForbiddenError handling,
// re-fetch-and-verify ownership, a named state check — but instead of a lifecycle transition it
// performs a single-row, single-column update. No transaction is needed: there is no cross-entity
// invariant (unlike acceptBooking, which is deliberately left untouched/frozen here), and no
// status changes, so there is no lifecycle hook to dispatch and — per the established convention
// for non-status booking field edits (see accept-booking.ts's silent vehicle write) — NO
// timeline/AuditLog row is written. Notifications are frozen (§20): this never notifies.
//
// AUTHORITY & PRIVACY: provider identity is server-derived (never trusted from the client); the
// booking must belong to this provider (else the uniform BOOKING_NOT_FOUND, revealing nothing);
// the payload is parsed + bounded server-side and stored/rendered as plain TEXT — it is not, and
// must never become, a contact channel (no phone/email; policy §14).

export type SetFulfillmentInstructionsResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function setBookingFulfillmentInstructions(
  bookingId: string,
  formData: FormData,
): Promise<SetFulfillmentInstructionsResult> {
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

  // Parse BEFORE any DB work — a malformed/over-length payload is rejected the same regardless of
  // booking state, and never reaches the row.
  const parsed = parseFulfillmentInstructionsForm(formData);
  if (!parsed.ok) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, providerId: true, status: true },
    });

    if (!booking || booking.providerId !== provider.id) {
      return { ok: false, error: "BOOKING_NOT_FOUND" };
    }

    if (!canEditFulfillmentInstructions(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_EDITABLE" };
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: { fulfillmentInstructions: fulfillmentInstructionsWrite(parsed.value) },
    });

    return { ok: true };
  } catch (error) {
    // Genuinely unexpected — never expose Prisma/internal exception details to the client; log
    // server-side only and return the generic code, matching start-booking.ts/accept-booking.ts.
    logger.error("setBookingFulfillmentInstructions.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
