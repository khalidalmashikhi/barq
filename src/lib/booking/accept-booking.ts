"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canAcceptBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { calculateCommissionAmount } from "@/lib/booking/calculate-commission";
import { getPaymentGatewayProvider } from "@/lib/payments/gateway/get-payment-gateway-provider";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Accept booking — Phase 4.1 ("Complete the Booking Lifecycle").
// Mirrors cancel-booking.ts's exact shape: "use server", UUID
// validation, requireProvider() with the same UnauthenticatedError/
// ForbiddenError handling, re-fetch-and-verify-ownership, a named
// policy check, transitionBooking() inside its own transaction, then
// dispatchLifecycleHook() only after that transaction has committed.
//
// No capacity change on acceptance — seats were already reserved at
// creation time (see create-booking.ts's atomic capacity guard); only
// cancellation/rejection release them.
//
// COMMISSION SNAPSHOT — Phase 2.11 (Checkout Foundation): this is the
// one and only code path that transitions a Booking to CONFIRMED (see
// lifecycle/transitions.ts — CONFIRMED is reachable only from
// PENDING_PROVIDER via this action), which is exactly where the schema
// already says the commission snapshot belongs ("/// Commission
// snapshot at confirmation" on Booking.commissionSnapshotAmount).
// Reads the provider's own ACTIVE Commission row (pre-existing model,
// previously never read by any application code) and computes the
// snapshot via calculateCommissionAmount(), in the same transaction as
// the status transition. A provider with no ACTIVE Commission row
// (administratively incomplete setup, not a booking-side error) leaves
// the snapshot null exactly as it already does today — logged, not
// blocking acceptance, since nothing about a missing Commission row is
// this booking's fault.
//
// PAYMENT RECORD — Phase 2.12 (Payment Foundation): DOMAIN_MODEL.md's
// own Booking relationships line says a Booking "produces... one
// Payment" upon confirmation, and Payment's own entry describes it as
// "Initiated -> Captured -> ..." — i.e. a Payment is expected to start
// existing, in INITIATED status, at exactly this same confirmation
// moment, not at actual capture. Creates exactly one Payment row
// (bookingId is @unique, and CONFIRMED is only ever reached once per
// booking via this action, so no duplicate-guard is needed — same
// reasoning already relied on for the commission write above).
// amount/currency are copied directly from the Booking's own fixed
// price snapshot, satisfying DOMAIN_MODEL.md's invariant that a
// Payment's amount must equal the Booking's price at confirmation —
// no capturedAt is set (capture is a distinct, later event).
//
// PROVIDER REFERENCE — Phase 2.24 (Provider Reference Persistence):
// paymentInitiation.providerReference (e.g. a real Stripe PaymentIntent
// id) is now persisted onto the Payment row it describes — previously
// discarded entirely, which is exactly what made real gateway capture()
// impossible (see capture-payment.ts's own comment). `?? null` handles
// the No-Op gateway's initiate(), which never returns one at all.
//
// GATEWAY ABSTRACTION — Phase 2.15A (Wire Payment Gateway Abstraction):
// this booking action no longer decides the initiation status itself.
// It obtains the gateway and consumes its initiate() result; the
// provider owns what "initiation" produces, this file only owns
// booking orchestration (fetch booking, check eligibility, decide
// whether a Payment applies at all, persist the row). Called once,
// before the transaction starts (the booking row is already in hand by
// then) rather than inside it: a provider's initiate() may perform real
// network I/O (e.g. creating a Stripe PaymentIntent), and network calls
// must never happen inside an open database transaction.
//
// RUNTIME WIRING — Phase 2.23 (Payment Gateway Runtime Wiring):
// getPaymentGatewayProvider() is now called with NO explicit key
// (previously hardcoded to "NONE"), so it resolves whichever gateway
// PAYMENT_PROVIDER selects (Phase 2.22A) — the identical
// "configuration change only" property already established for every
// other omitted-key caller. With PAYMENT_PROVIDER unset (the default),
// behavior is byte-for-byte identical to before: the No-Op provider's
// initiate() always resolves { status: "INITIATED" }. With
// PAYMENT_PROVIDER=STRIPE and real credentials configured, this now
// performs a genuine Stripe PaymentIntent creation — any failure
// (network, invalid credentials, invalid amount) is caught by this
// function's own existing outer try/catch and returned as the same
// generic UNKNOWN_ERROR every other unexpected failure already uses;
// no new error state was invented for this.

export type AcceptBookingResult = { ok: true } | { ok: false; error: BookingActionErrorCode };

export async function acceptBooking(bookingId: string): Promise<AcceptBookingResult> {
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

    if (!canAcceptBooking(booking.status)) {
      return { ok: false, error: "BOOKING_NOT_PENDING" };
    }

    // Obtain the gateway and consume its result — this action no longer
    // decides the initiation status itself. Computed before the
    // transaction starts (see this file's own module comment for why).
    const paymentInitiation =
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency !== null
        ? await getPaymentGatewayProvider().initiate({
            bookingId: booking.id,
            amount: booking.priceSnapshotAmount.toString(),
            currency: booking.priceSnapshotCurrency,
          })
        : null;

    const hookContext = await prisma.$transaction(async (tx) => {
      const ctx = await transitionBooking(
        { bookingId: booking.id, toStatus: "CONFIRMED", actorType: "PROVIDER", actorId: provider.id },
        tx
      );

      const commission = await tx.commission.findFirst({
        where: { providerId: booking.providerId, status: "ACTIVE" },
      });

      if (commission && booking.priceSnapshotAmount !== null) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            commissionSnapshotTier: commission.tier,
            commissionSnapshotAmount: calculateCommissionAmount(booking.priceSnapshotAmount.toString(), commission.tier),
          },
        });
      } else if (!commission) {
        logger.warn("acceptBooking.no_active_commission", { bookingId: booking.id, providerId: booking.providerId });
      }

      if (paymentInitiation && booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency !== null) {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            amount: booking.priceSnapshotAmount,
            currency: booking.priceSnapshotCurrency,
            status: paymentInitiation.status,
            providerReference: paymentInitiation.providerReference ?? null,
          },
        });
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
    logger.error("acceptBooking.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
