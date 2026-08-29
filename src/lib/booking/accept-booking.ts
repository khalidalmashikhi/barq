"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canAcceptBooking } from "@/lib/booking/cancellation-policy";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
// Imported from the concrete errors module (NOT the lifecycle barrel) so the class
// identity survives tests that mock "@/lib/booking/lifecycle" — the instanceof check below
// must compare against the SAME class transitionBooking() actually throws.
import { ConcurrentBookingModificationError } from "@/lib/booking/lifecycle/errors";
import { calculateCommissionAmount } from "@/lib/booking/calculate-commission";
import { resolveBookingChargeMoney } from "@/lib/booking/pricing/resolve-booking-money";
import { getPaymentGatewayProvider } from "@/lib/payments/gateway/get-payment-gateway-provider";
import {
  resolveVehicleAssignmentForAcceptance,
  type VehicleAssignmentError,
} from "@/lib/booking/vehicle-assignment-on-accept";
import { validateOperationalInterval, type OperationalInterval } from "@/lib/booking/operational-interval";
import { reserveVehicleForBooking } from "@/lib/booking/vehicle-reservation";
import { logger } from "@/lib/logger";
import type { BookingActionErrorCode } from "./booking-action-errors";

// BOOKING-VEHICLE-1 — thrown ONLY inside the acceptance transaction to abort it when the
// in-transaction eligibility re-check fails (a vehicle that was eligible at the pre-check
// became ineligible before commit). Carries the exact code back to the caller's catch so
// nothing is left half-applied (no CONFIRMED status, no Payment row, no vehicle write).
class VehicleAssignmentAbortError extends Error {
  constructor(readonly code: VehicleAssignmentError) {
    super(`vehicle assignment aborted: ${code}`);
    this.name = "VehicleAssignmentAbortError";
  }
}

// BOOKING-CONFLICT-1B — thrown ONLY inside the acceptance transaction when the atomic
// vehicle reservation cannot be committed, carrying the mapped BookingActionErrorCode back to
// the caller's catch. Aborting here rolls the whole transaction back (the CONFIRMED transition,
// commission, Payment row, vehicleId/snapshot write), so a booking that loses the reservation
// race is left exactly as it was: PENDING_PROVIDER, no vehicle, no payment.
class VehicleReservationAbortError extends Error {
  constructor(readonly code: BookingActionErrorCode) {
    super(`vehicle reservation aborted: ${code}`);
    this.name = "VehicleReservationAbortError";
  }
}

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

// BOOKING-VEHICLE-1: `vehicleId` is the vehicle the PROVIDER selected to commit to this
// booking. It is REQUIRED for transport tour packages (GUIDE_WITH_TRANSPORT /
// GUIDE_WITH_4X4), optional for PRIVATE_CUSTOM_TOUR, and ignored for GUIDE_ONLY / non-tour
// services (where Booking.vehicleId stays null). Provider identity is always server-derived;
// the vehicle is validated against the service's pool + live eligibility + the booking's
// party — never trusted from the client beyond being an id the provider chose.
// BOOKING-INTERVAL-1: `operationalStartAt`/`operationalEndAt` are the provider-supplied
// operational schedule (already parsed to absolute instants by the caller — Web via
// omanLocalToUtc, API via ISO parse). They are consulted ONLY when a vehicle is being
// assigned AND the booking has no interval yet (slotless transport). For a slot-based
// booking the interval already exists (snapshotted at create) and the provider CANNOT
// override it — any supplied values are ignored. Non-vehicle acceptance ignores them.
export async function acceptBooking(
  bookingId: string,
  vehicleId?: string | null,
  operationalStartAt?: Date | null,
  operationalEndAt?: Date | null,
): Promise<AcceptBookingResult> {
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

    // DOWNSTREAM MONEY ALIGNMENT — resolve the ONE authoritative amount to charge/record BEFORE
    // any financial side effect (gateway initiation, commission, Payment). A LEGACY booking
    // charges its historical unit snapshot; a TOTALIZED booking charges its authoritative total;
    // an INVALID/ABSENT snapshot FAILS CLOSED here (no transition, no artifacts) rather than
    // charging a wrong amount or silently downgrading to the unit price.
    const charge = resolveBookingChargeMoney(booking);
    if (!charge.ok) {
      logger.warn("acceptBooking.unresolvable_money", { bookingId: booking.id, reason: charge.reason });
      return { ok: false, error: "BOOKING_PRICING_INVALID" };
    }
    const bookingTotal = charge.money.total;
    const bookingCurrency = charge.money.currency;

    // BOOKING-VEHICLE-1 — resolve the vehicle assignment BEFORE payment initiation, so an
    // invalid/ineligible vehicle never creates a gateway intent (§7). Non-tour / GUIDE_ONLY
    // resolve to { vehicleId: null } and leave acceptance byte-for-byte unchanged.
    const assignment = await resolveVehicleAssignmentForAcceptance({
      db: prisma,
      serviceId: booking.serviceId,
      providerId: provider.id,
      seats: booking.seats,
      vehicleId: vehicleId ?? null,
    });
    if (!assignment.ok) {
      return { ok: false, error: assignment.error };
    }

    // BOOKING-INTERVAL-1 — a vehicle-required acceptance needs an authoritative operational
    // interval (start < end). Resolved BEFORE payment initiation so a missing/invalid schedule
    // never creates a gateway intent. Slot-based bookings already carry the interval from
    // create → use it, ignore any supplied schedule (provider cannot override). Slotless
    // bookings need the provider to supply it now; absent → SCHEDULE_REQUIRED, broken →
    // INVALID_SCHEDULE. No interval requirement when no vehicle is assigned.
    let intervalToWrite: OperationalInterval | null = null;
    if (assignment.vehicleId !== null) {
      // `?? null` normalizes an absent field to null so a slot-derived interval is detected
      // whether the row carries null (real DB) or the field is simply unset.
      const hasExistingInterval =
        (booking.operationalStartAt ?? null) !== null && (booking.operationalEndAt ?? null) !== null;
      if (!hasExistingInterval) {
        const validated = validateOperationalInterval(operationalStartAt ?? null, operationalEndAt ?? null);
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        intervalToWrite = validated.interval;
      }
    }

    // Obtain the gateway and consume its result — this action no longer
    // decides the initiation status itself. Computed before the
    // transaction starts (see this file's own module comment for why).
    // Same authoritative total feeds the gateway, commission, and Payment — never three
    // separate derivations. Gateway stays inert (no-op provider); only the AMOUNT is aligned.
    const paymentInitiation = await getPaymentGatewayProvider().initiate({
      bookingId: booking.id,
      amount: bookingTotal.toString(),
      currency: bookingCurrency,
    });

    const hookContext = await prisma.$transaction(async (tx) => {
      const ctx = await transitionBooking(
        { bookingId: booking.id, toStatus: "CONFIRMED", actorType: "PROVIDER", actorId: provider.id },
        tx
      );

      const commission = await tx.commission.findFirst({
        where: { providerId: booking.providerId, status: "ACTIVE" },
      });

      if (commission) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            commissionSnapshotTier: commission.tier,
            // Commission on the authoritative booking TOTAL (Decimal), not the unit price.
            commissionSnapshotAmount: calculateCommissionAmount(bookingTotal, commission.tier),
          },
        });
      } else {
        logger.warn("acceptBooking.no_active_commission", { bookingId: booking.id, providerId: booking.providerId });
      }

      await tx.payment.create({
        data: {
          bookingId: booking.id,
          amount: bookingTotal,
          currency: bookingCurrency,
          status: paymentInitiation.status,
          providerReference: paymentInitiation.providerReference ?? null,
        },
      });

      // BOOKING-VEHICLE-1 — persist the committed vehicle in the SAME transaction as
      // CONFIRMED, re-checking eligibility INSIDE the tx first (TOCTOU: a vehicle eligible
      // at the pre-check may have expired/deactivated before commit). Only runs when a
      // vehicle is actually being assigned; the no-vehicle path is entirely unchanged. A
      // failed re-check throws, rolling back the transition + commission + payment together.
      if (assignment.vehicleId !== null) {
        const revalidated = await resolveVehicleAssignmentForAcceptance({
          db: tx,
          serviceId: booking.serviceId,
          providerId: provider.id,
          seats: booking.seats,
          vehicleId: assignment.vehicleId,
        });
        if (!revalidated.ok) throw new VehicleAssignmentAbortError(revalidated.error);
        // BOOKING-VEHICLE-SNAPSHOT — write the authoritative vehicleId AND its customer-safe
        // historical snapshot together in this one update, so a confirmed vehicle-required
        // booking can never end up with a vehicleId but no snapshot (or vice-versa). The
        // snapshot is non-null exactly when vehicleId is; requiring BOTH here enforces that.
        if (revalidated.vehicleId !== null && revalidated.snapshot !== null) {
          // BOOKING-CONFLICT-1B — reserve the physical vehicle for this booking's operational
          // window BEFORE writing the assignment, inside this same transaction. The window is
          // the provider-supplied schedule for a slotless booking (intervalToWrite) or the
          // slot-derived interval already on the booking — the exact interval this update will
          // persist, so the reservation and Booking.operationalStartAt/endAt always agree. The
          // reservation primitive takes a per-vehicle advisory lock + overlap check + insert,
          // so of two concurrent acceptances of the same vehicle for overlapping windows exactly
          // one commits; the loser gets VEHICLE_BUSY and this whole transaction rolls back.
          const reservationInterval: OperationalInterval | null =
            intervalToWrite ??
            ((booking.operationalStartAt ?? null) !== null && (booking.operationalEndAt ?? null) !== null
              ? { startsAt: booking.operationalStartAt as Date, endsAt: booking.operationalEndAt as Date }
              : null);
          if (reservationInterval === null) {
            // Impossible in practice — a vehicle assignment always has an interval by this point
            // (the pre-tx gate above rejects a missing one). Fail closed rather than reserve an
            // unbounded window; map to the existing schedule domain error, never an internal shape.
            throw new VehicleReservationAbortError("INVALID_SCHEDULE");
          }

          const reservation = await reserveVehicleForBooking(tx, {
            bookingId: booking.id,
            vehicleId: revalidated.vehicleId,
            startsAt: reservationInterval.startsAt,
            endsAt: reservationInterval.endsAt,
          });
          if (!reservation.ok) {
            if (reservation.reason === "VEHICLE_BUSY") {
              // Safe conflict signal — booking + vehicle + requested window only; NEVER the
              // conflicting booking/customer/reservation (see §21). Fires inside the tx that is
              // about to roll back, which is fine: it is a log line, not a DB write.
              logger.warn("acceptBooking.vehicle_busy", {
                bookingId: booking.id,
                vehicleId: revalidated.vehicleId,
                startsAt: reservationInterval.startsAt.toISOString(),
                endsAt: reservationInterval.endsAt.toISOString(),
              });
            }
            // VEHICLE_BUSY → the new domain conflict code. INVALID_INTERVAL is impossible here
            // (guarded above) → defensively the existing INVALID_SCHEDULE. ALREADY_RESERVED
            // means a reservation already exists for this booking (a stale/double accept that
            // slipped past the status guard) → the existing stale-state BOOKING_STATE_CONFLICT;
            // never a silent second reservation.
            const code: BookingActionErrorCode =
              reservation.reason === "VEHICLE_BUSY"
                ? "VEHICLE_BUSY"
                : reservation.reason === "ALREADY_RESERVED"
                  ? "BOOKING_STATE_CONFLICT"
                  : "INVALID_SCHEDULE";
            throw new VehicleReservationAbortError(code);
          }

          await tx.booking.update({
            where: { id: booking.id },
            data: {
              vehicleId: revalidated.vehicleId,
              vehicleSnapshot: revalidated.snapshot as unknown as Prisma.InputJsonValue,
              // BOOKING-INTERVAL-1 — persist the provider-supplied schedule (slotless only;
              // null when the booking already had a slot-derived interval) in the SAME update
              // as vehicleId/snapshot, so a confirmed vehicle-required booking always ends up
              // with a valid interval AND its vehicle together, or neither.
              ...(intervalToWrite
                ? { operationalStartAt: intervalToWrite.startsAt, operationalEndAt: intervalToWrite.endsAt }
                : {}),
            },
          });
        }
      }

      return ctx;
    });

    // Fired only after the transaction above has actually committed —
    // see transition-booking.ts's own comment for why this must happen
    // out here, not inside transitionBooking() itself.
    await dispatchLifecycleHook(hookContext);

    return { ok: true };
  } catch (error) {
    // BOOKING-VEHICLE-1 — the in-transaction vehicle re-check failed: return its exact
    // code. The whole transaction rolled back, so the booking is still PENDING_PROVIDER,
    // vehicleId is still null, and no Payment/commission was written.
    if (error instanceof VehicleAssignmentAbortError) {
      return { ok: false, error: error.code };
    }
    // BOOKING-CONFLICT-1B — the in-transaction vehicle reservation could not be committed
    // (overlapping active reservation → VEHICLE_BUSY, or a stale double-accept). The whole
    // transaction rolled back: booking still PENDING_PROVIDER, vehicleId/snapshot still null,
    // no Payment/commission/status-event written, no reservation row.
    if (error instanceof VehicleReservationAbortError) {
      return { ok: false, error: error.code };
    }
    // A genuine concurrent-modification race inside transitionBooking()'s guarded write —
    // the booking left PENDING_PROVIDER between our read and our write. Distinct from
    // BOOKING_NOT_PENDING (the up-front check); the client re-reads the booking's status.
    if (error instanceof ConcurrentBookingModificationError) {
      return { ok: false, error: "BOOKING_STATE_CONFLICT" };
    }
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
