import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { omanDateKeyFromDbDate } from "@/lib/date/oman-time";
import { recordBookingCreated, transitionBooking } from "@/lib/booking/lifecycle";
import { isUniqueViolation } from "../rental-offering-authorization";
import { resolveRentalDayQuote } from "../reservation/resolve-rental-day-quote";
import { RENTAL_PRICING_UNIT, type ExpectedQuote, type RentalHoldQuote } from "../reservation/reservation-types";

// Phase 3C Slice C3/E2 — the AUTHORITATIVE, server-only atomic confirmation: turn ONE live C3/E1
// daily-rental hold into exactly ONE Booking and transition every selected date HELD→CONFIRMED, all
// in ONE transaction. It reuses the canonical Booking model (a TOTALIZED PER_VEHICLE_DAY money
// snapshot + an immutable rental snapshot), the lifecycle engine (CREATED→PENDING_PROVIDER), and the
// BookingIdempotencyKey DB arbiter. Rules honored: all-or-nothing (Booking + child CONFIRMED commit
// together or not at all); no confirmed child without its Booking in the same tx; owner-only (never
// another customer's hold); hold token is never authorization; passenger count is capacity-only;
// price never multiplies by passengers; confirmation cannot win after expiry (guarded child update).
// NO payment. NO lifecycle-hook dispatch here (provider notification/email is out of this slice's
// scope) — the Booking is created PENDING_PROVIDER and is visible in provider surfaces; wiring the
// notification is deferred. Reads NO legacy Price; touches no guided table.

/** The immutable, customer-safe rental snapshot persisted on Booking.rentalSnapshot. */
export type RentalBookingSnapshot = {
  rentalOfferingId: string;
  vehicleId: string;
  vehicle: {
    make: string | null;
    model: string | null;
    modelYear: number | null;
    color: string | null;
    vehicleType: string | null;
    /** The verified effective bookable capacity at confirmation (override ?? verified). Capacity only. */
    bookablePassengerCapacity: number;
  };
  /** Customer party size — capacity-validated, NEVER a price multiplier. */
  passengerCount: number;
  /** Sorted, unique selected Oman day keys. */
  dateKeys: string[];
  /** Per-date authoritative price snapshot. */
  perDate: { dateKey: string; amount: string; currency: string; source: "BASE" | "OVERRIDE" }[];
  chargeableDays: number;
  total: string;
  currency: string;
  holdGroupId: string;
  quoteFingerprint: string;
  pricingUnit: typeof RENTAL_PRICING_UNIT;
  timeZone: "Asia/Muscat";
};

export type ConfirmRentalHoldParams = {
  /** Server-DERIVED authenticated owner (requireCustomer → customer.id). NEVER client-supplied. */
  customerId: string;
  /** The public hold-group identifier (path param). Ownership is still re-checked against customerId. */
  holdGroupId: string;
  /** REQUIRED confirmation idempotency key (validated by the caller). */
  confirmationIdempotencyKey: string;
  /** REQUIRED: the quote the customer explicitly accepted (fingerprint and/or total+currency). */
  expectedQuote: ExpectedQuote;
  now?: Date;
};

export type ConfirmedRentalBooking = { id: string; status: string; rentalSnapshot: RentalBookingSnapshot };

export type ConfirmRentalHoldFailure =
  | "HOLD_NOT_FOUND" // missing / not owned by this customer (non-enumerating)
  | "HOLD_EXPIRED" // the hold's children lapsed before confirmation
  | "HOLD_NOT_CONFIRMABLE" // already confirmed / released / cancelled / partial — not a live HELD group
  | "NOT_BOOKABLE" // service/provider/vertical/vehicle no longer eligible (cause hidden)
  | "CAPACITY_EXCEEDED" // verified capacity dropped below the held passenger count
  | "DAY_NOT_AVAILABLE" // a selected day is no longer an OPEN priced day
  | "PRICE_CHANGED" // the current authoritative quote differs from what the customer accepted
  | "IDEMPOTENCY_MISMATCH" // confirmation key reused for a materially different request
  | "VEHICLE_DATE_CONFLICT" // a concurrent confirmation won the same key (mapped safely)
  | "READ_FAILED";

export type ConfirmRentalHoldResult =
  | { ok: true; booking: ConfirmedRentalBooking; replayed: boolean }
  | { ok: false; reason: ConfirmRentalHoldFailure; quote?: RentalHoldQuote };

/** Deterministic confirmation-request fingerprint: the hold + the exact quote the customer accepted. */
function computeConfirmationFingerprint(holdGroupId: string, expected: ExpectedQuote): string {
  const fingerprint = "fingerprint" in expected ? expected.fingerprint : "";
  const total = "total" in expected ? expected.total : "";
  const currency = "total" in expected ? expected.currency : "";
  return createHash("sha256").update(JSON.stringify(["rental-confirm-v1", holdGroupId, fingerprint, total, currency])).digest("hex");
}

type GroupRow = {
  id: string;
  rentalOfferingId: string;
  passengerCount: number;
  bookingId: string | null;
  reservations: { serviceDate: Date; status: string; expiresAt: Date | null }[];
};

/** Load an already-created rental Booking for an idempotent replay (returns its current state). */
async function loadConfirmedRentalBooking(db: PrismaClient, bookingId: string): Promise<ConfirmedRentalBooking | null> {
  const row = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true, status: true, rentalSnapshot: true } });
  if (!row || row.rentalSnapshot === null) return null;
  return { id: row.id, status: row.status, rentalSnapshot: row.rentalSnapshot as unknown as RentalBookingSnapshot };
}

export async function confirmDailyRentalHoldAndCreateBooking(
  prisma: PrismaClient,
  params: ConfirmRentalHoldParams,
): Promise<ConfirmRentalHoldResult> {
  const now = params.now ?? new Date();
  const requestFingerprint = computeConfirmationFingerprint(params.holdGroupId, params.expectedQuote);

  try {
    // ---- Idempotency fast path (DB-backed): a claimed confirmation key replays its Booking, or a
    // reused key with a different request is a mismatch. ----
    const priorKey = await prisma.bookingIdempotencyKey.findUnique({
      where: { customerId_idempotencyKey: { customerId: params.customerId, idempotencyKey: params.confirmationIdempotencyKey } },
      select: { requestFingerprint: true, bookingId: true },
    });
    if (priorKey) {
      if (priorKey.requestFingerprint !== requestFingerprint) return { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
      const replay = await loadConfirmedRentalBooking(prisma, priorKey.bookingId);
      if (replay) return { ok: true, booking: replay, replayed: true };
      return { ok: false, reason: "READ_FAILED" };
    }

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: params.customerId }, select: { id: true } });
      if (!customer) return { ok: false as const, reason: "HOLD_NOT_FOUND" as const };

      // Owner-scoped hold group (non-enumerating: foreign/missing → HOLD_NOT_FOUND). Token is never auth.
      const group = (await tx.rentalVehicleDayHoldGroup.findFirst({
        where: { id: params.holdGroupId, customerId: params.customerId },
        select: {
          id: true,
          rentalOfferingId: true,
          passengerCount: true,
          bookingId: true,
          reservations: { select: { serviceDate: true, status: true, expiresAt: true } },
        },
      })) as unknown as GroupRow | null;
      if (!group) return { ok: false as const, reason: "HOLD_NOT_FOUND" as const };

      if (group.reservations.length === 0) return { ok: false as const, reason: "HOLD_NOT_CONFIRMABLE" as const };
      // Every child must be a LIVE HELD row: not already confirmed/released/cancelled/expired.
      if (group.reservations.some((r) => r.status !== "HELD")) return { ok: false as const, reason: "HOLD_NOT_CONFIRMABLE" as const };
      if (group.reservations.some((r) => r.expiresAt === null || r.expiresAt <= now)) return { ok: false as const, reason: "HOLD_EXPIRED" as const };

      const sortedDateKeys = group.reservations.map((r) => omanDateKeyFromDbDate(r.serviceDate)).sort();

      // Re-resolve the authoritative quote at the current server instant (same authority as acquire).
      const r = await resolveRentalDayQuote(tx, { offeringId: group.rentalOfferingId, passengerCount: group.passengerCount, sortedDateKeys, now });
      if (!r.ok) return { ok: false as const, reason: r.reason };
      const { offering, vehicleId, effectiveCapacity, quote } = r;

      // Price-drift: the current authoritative quote vs the quote the customer explicitly accepted.
      const fpMismatch = "fingerprint" in params.expectedQuote && params.expectedQuote.fingerprint !== quote.quoteFingerprint;
      const totalMismatch = "total" in params.expectedQuote && (params.expectedQuote.total !== quote.total || params.expectedQuote.currency !== quote.currency);
      if (fpMismatch || totalMismatch) return { ok: false as const, reason: "PRICE_CHANGED" as const, quote };

      // ---- Commit: Booking + rental snapshot + hold link + child CONFIRMED + idempotency + audit. ----
      const snapshot: RentalBookingSnapshot = {
        rentalOfferingId: offering.id,
        vehicleId,
        vehicle: {
          make: offering.vehicle.make,
          model: offering.vehicle.model,
          modelYear: offering.vehicle.modelYear,
          color: offering.vehicle.color,
          vehicleType: offering.vehicle.vehicleType,
          bookablePassengerCapacity: effectiveCapacity,
        },
        passengerCount: group.passengerCount,
        dateKeys: quote.dateKeys,
        perDate: quote.days.map((d) => ({ dateKey: d.dateKey, amount: d.amount, currency: d.currency, source: d.priceSource })),
        chargeableDays: quote.chargeableDays,
        total: quote.total,
        currency: quote.currency,
        holdGroupId: group.id,
        quoteFingerprint: quote.quoteFingerprint,
        pricingUnit: RENTAL_PRICING_UNIT,
        timeZone: "Asia/Muscat",
      };

      // Canonical Booking row. Money is TOTALIZED (resolveBookingMoney recognizes it): the authoritative
      // total is the per-date SUM; billableQuantitySnapshot is 1 (no unit×qty multiplication — the days
      // are a sum, not a multiplier) so no surface renders a misleading breakdown. seats=1 (slotless,
      // neutral); passenger count lives ONLY in the rental snapshot, never a billing quantity.
      const total = new Prisma.Decimal(quote.total);
      const booking = await tx.booking.create({
        data: {
          customerId: params.customerId,
          serviceId: offering.serviceId,
          providerId: offering.providerId,
          seats: 1,
          priceSnapshotAmount: total,
          priceSnapshotCurrency: quote.currency,
          pricingUnitSnapshot: RENTAL_PRICING_UNIT,
          billableQuantitySnapshot: 1,
          bookingTotalSnapshot: total,
          rentalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await recordBookingCreated({ bookingId: booking.id, actorType: "CUSTOMER", actorId: params.customerId }, tx);
      await transitionBooking({ bookingId: booking.id, toStatus: "PENDING_PROVIDER", actorType: "SYSTEM" }, tx);

      // Link the hold group to its Booking.
      await tx.rentalVehicleDayHoldGroup.update({ where: { id: group.id }, data: { bookingId: booking.id } });

      // GUARDED HELD→CONFIRMED for every selected day. The `expiresAt: { gt: now }` predicate makes
      // this lose atomically to a concurrent expiry: if any child lapsed/changed since the read, the
      // updated count < expected → throw → the whole tx (Booking + link + idempotency) rolls back.
      // CONFIRMED rows carry no expiry (migration CHECK) — set expiresAt null in the same update.
      const confirmed = await tx.rentalVehicleDayReservation.updateMany({
        where: { holdGroupId: group.id, status: "HELD", expiresAt: { gt: now } },
        data: { status: "CONFIRMED", expiresAt: null },
      });
      if (confirmed.count !== sortedDateKeys.length) throw new Error("RENTAL_CONFIRM_GUARD_MISMATCH");

      // Claim the confirmation idempotency key LAST — its @@unique(customerId, idempotencyKey) is the
      // DB race arbiter: a concurrent duplicate confirmation hits P2002 and this whole tx rolls back.
      await tx.bookingIdempotencyKey.create({
        data: { customerId: params.customerId, idempotencyKey: params.confirmationIdempotencyKey, requestFingerprint, bookingId: booking.id },
      });

      // In-tx rental audit (BookingStatusEvent already records the lifecycle; this records the link).
      await tx.auditLog.create({
        data: {
          actorType: "CUSTOMER",
          actorId: params.customerId,
          action: "rental.hold_confirmed",
          entityType: "Booking",
          entityId: booking.id,
          newValue: { bookingId: booking.id, holdGroupId: group.id, dateKeys: quote.dateKeys, chargeableDays: quote.chargeableDays, total: quote.total, currency: quote.currency },
        },
      });

      return { ok: true as const, booking: { id: booking.id, status: "PENDING_PROVIDER", rentalSnapshot: snapshot }, replayed: false };
    });

    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "RENTAL_CONFIRM_GUARD_MISMATCH") {
      // A concurrent expiry (or any child-state change) beat the guarded confirm → the hold is no
      // longer fully live. Report expiry; no Booking was created (tx rolled back).
      return { ok: false, reason: "HOLD_EXPIRED" };
    }
    if (isUniqueViolation(error)) {
      // Either a concurrent duplicate confirmation under the same key, or the child active-unique
      // (a foreign confirmed reservation). Re-read the key: replay the committed Booking, or mismatch.
      try {
        const priorKey = await prisma.bookingIdempotencyKey.findUnique({
          where: { customerId_idempotencyKey: { customerId: params.customerId, idempotencyKey: params.confirmationIdempotencyKey } },
          select: { requestFingerprint: true, bookingId: true },
        });
        if (priorKey) {
          if (priorKey.requestFingerprint !== requestFingerprint) return { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
          const replay = await loadConfirmedRentalBooking(prisma, priorKey.bookingId);
          if (replay) return { ok: true, booking: replay, replayed: true };
        }
      } catch {
        /* fall through */
      }
      return { ok: false, reason: "VEHICLE_DATE_CONFLICT" };
    }
    logger.error("confirmDailyRentalHold.read_failed", {
      holdGroupId: params.holdGroupId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "READ_FAILED" };
  }
}
