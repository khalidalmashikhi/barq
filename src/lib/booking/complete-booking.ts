"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canCompleteBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { releaseVehicleReservationForBooking } from "@/lib/booking/vehicle-reservation";
import { generateInvoiceNumber } from "@/lib/invoicing/generate-invoice-number";
import { buildInvoiceContent } from "@/lib/invoicing/build-invoice-content";
import { resolveBookingChargeMoney } from "@/lib/booking/pricing/resolve-booking-money";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Complete booking — Phase 4.2 ("Provider Experience," Priority 3 —
// Booking Operations). Mirrors start-booking.ts's exact shape.
//
// No capacity change — a completed booking keeps its seats counted
// against the slot's bookedCount, same as any other non-released
// terminal state (only cancel/reject release capacity).
//
// INVOICE GENERATION — Phase 2.13 (Invoice Foundation): this is the
// discovered, correct lifecycle point for Invoice creation — NOT
// Booking CONFIRMED. DATABASE_DESIGN.md's own context-ownership table
// lists Invoicing's trigger as "Booking Confirmed/Completed, Payment
// Received," and the one real precedent already in this codebase
// (prisma/seed.ts) only ever creates an Invoice for a COMPLETED
// booking, never a merely-CONFIRMED one. Tying it to COMPLETED instead
// of CONFIRMED is also the only choice consistent with this phase's own
// explicit "No Credit Note workflow" exclusion: CONFIRMED can still
// transition to CANCELLED or DISPUTED (see lifecycle/transitions.ts) —
// issuing an Invoice that early would routinely need correcting via the
// Credit Note mechanism this phase is not building. COMPLETED has only
// one outgoing transition (-> DISPUTED), so an Invoice created here is
// never routinely at risk of needing that correction. Documented in
// docs/project-memory/19-EVENT-CATALOG.md before this was implemented,
// per this phase's own instruction.
//
// Links the real Payment already created at CONFIRMED (Phase 2.12) via
// its paymentId when one exists — never duplicates that lookup's
// result, never recomputes an amount: content is built directly from
// the Booking's own fixed price snapshot, the same snapshot Payment
// itself was built from. No duplicate-guard is needed for the Invoice
// row itself: bookingId is @unique and COMPLETED, like CONFIRMED, is
// reachable at most once per booking's lifetime via this action.

export type CompleteBookingResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function completeBooking(bookingId: string): Promise<CompleteBookingResult> {
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
      include: { service: true },
    });

    if (!booking || booking.providerId !== provider.id) {
      return { ok: false, error: "BOOKING_NOT_FOUND" };
    }

    if (!canCompleteBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_COMPLETABLE" };
    }

    // DOWNSTREAM MONEY ALIGNMENT — the invoice records the ONE authoritative amount (a LEGACY
    // booking's historical unit snapshot; a TOTALIZED booking's total). Resolve BEFORE the
    // transaction; an INVALID/ABSENT snapshot FAILS CLOSED (no completion, no false invoice)
    // rather than invoicing a wrong or unit-only amount. In practice a booking reaching
    // completion already passed acceptance's identical check, so this only guards corrupt data.
    const charge = resolveBookingChargeMoney(booking);
    if (!charge.ok) {
      logger.warn("completeBooking.unresolvable_money", { bookingId: booking.id, reason: charge.reason });
      return { ok: false, error: "BOOKING_PRICING_INVALID" };
    }

    const hookContext = await prisma.$transaction(async (tx) => {
      const ctx = await transitionBooking(
        { bookingId: booking.id, toStatus: "COMPLETED", actorType: "PROVIDER", actorId: provider.id },
        tx
      );

      {
        const payment = await tx.payment.findUnique({ where: { bookingId: booking.id } });
        const serviceName = booking.service.name as { ar: string; en: string };
        const invoiceNumber = await generateInvoiceNumber({}, tx);
        const content = buildInvoiceContent({
          serviceName,
          // The authoritative booking total (Decimal), not the unit price.
          amount: charge.money.total.toString(),
          currency: charge.money.currency,
        });

        await tx.invoice.create({
          data: {
            bookingId: booking.id,
            paymentId: payment?.id ?? null,
            invoiceNumber,
            content,
            issuedAt: new Date(),
          },
        });
      }

      // BOOKING-CONFLICT-1B — the service is over: release the vehicle's physical-occupancy
      // hold in the SAME transaction as the COMPLETED transition and invoice creation, freeing
      // the vehicle's window for future bookings. Idempotent (0 rows for a non-vehicle or
      // legacy booking); never deletes; never clears vehicleId / snapshot / operational interval
      // — the assignment stays on the completed booking as history.
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
    // generic code, matching start-booking.ts/cancel-booking.ts.
    logger.error("completeBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
