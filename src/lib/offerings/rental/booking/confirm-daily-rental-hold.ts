import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { omanDateKeyFromDbDate, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { recordBookingCreated, transitionBooking } from "@/lib/booking/lifecycle";
import { isUniqueViolation } from "../rental-offering-authorization";
import { resolveRentalDayQuote } from "../reservation/resolve-rental-day-quote";
import { RENTAL_PRICING_UNIT, RENTAL_PROVIDER_RESPONSE_HOURS, type ExpectedQuote, type RentalHoldQuote } from "../reservation/reservation-types";

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

/** Look up + replay a committed confirmation key (same fingerprint) or report a mismatch. */
async function replayConfirmationKey(
  prisma: PrismaClient,
  customerId: string,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<{ replay: ConfirmRentalHoldResult } | { missing: true }> {
  const priorKey = await prisma.bookingIdempotencyKey.findUnique({
    where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
    select: { requestFingerprint: true, bookingId: true },
  });
  if (!priorKey) return { missing: true };
  if (priorKey.requestFingerprint !== requestFingerprint) return { replay: { ok: false, reason: "IDEMPOTENCY_MISMATCH" } };
  const booking = await loadConfirmedRentalBooking(prisma, priorKey.bookingId);
  return { replay: booking ? { ok: true, booking, replayed: true } : { ok: false, reason: "READ_FAILED" } };
}

/** Bounded retries for the rare group-idempotency rollback race (a competitor claimed then rolled back). */
const MAX_CONFIRM_ATTEMPTS = 3;

export async function confirmDailyRentalHoldAndCreateBooking(
  prisma: PrismaClient,
  params: ConfirmRentalHoldParams,
): Promise<ConfirmRentalHoldResult> {
  const now = params.now ?? new Date();
  const requestFingerprint = computeConfirmationFingerprint(params.holdGroupId, params.expectedQuote);

  for (let attempt = 0; attempt < MAX_CONFIRM_ATTEMPTS; attempt++) {
    try {
      // ---- Idempotency fast path (DB-backed): a claimed confirmation key replays its Booking (its
      // CURRENT state), or a reused key with a different request is a mismatch. ----
      const prior = await replayConfirmationKey(prisma, params.customerId, params.confirmationIdempotencyKey, requestFingerprint);
      if ("replay" in prior) return prior.replay;

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
        // A live hold: not already linked to a Booking, every child a live HELD row (not confirmed/
        // released/cancelled/expired).
        if (group.bookingId !== null || group.reservations.some((r) => r.status !== "HELD")) return { ok: false as const, reason: "HOLD_NOT_CONFIRMABLE" as const };
        if (group.reservations.some((r) => r.expiresAt === null || r.expiresAt <= now)) return { ok: false as const, reason: "HOLD_EXPIRED" as const };

        const sortedDateKeys = group.reservations.map((r) => omanDateKeyFromDbDate(r.serviceDate)).sort();

        // Re-resolve the authoritative quote at the current server instant (same authority as acquire).
        const r = await resolveRentalDayQuote(tx, { offeringId: group.rentalOfferingId, passengerCount: group.passengerCount, sortedDateKeys, now });
        if (!r.ok) return { ok: false as const, reason: r.reason };
        const { offering, vehicleId, effectiveCapacity, quote, resolved } = r;

        // Price-drift: the current authoritative quote vs the quote the customer explicitly accepted.
        // On drift, write NOTHING and leave the live hold intact until its original expiry.
        const fpMismatch = "fingerprint" in params.expectedQuote && params.expectedQuote.fingerprint !== quote.quoteFingerprint;
        const totalMismatch = "total" in params.expectedQuote && (params.expectedQuote.total !== quote.total || params.expectedQuote.currency !== quote.currency);
        if (fpMismatch || totalMismatch) return { ok: false as const, reason: "PRICE_CHANGED" as const, quote };

        // ---- Commit (ONE final authoritative confirmed quote written EVERYWHERE it lives): Booking +
        // rental snapshot + idempotency (claimed EARLY) + hold-group final quote + per-date child
        // CONFIRMED + audit. Every artifact below carries the SAME recomputed quote. ----
        const total = new Prisma.Decimal(quote.total);
        const snapshot: RentalBookingSnapshot = {
          rentalOfferingId: offering.id,
          vehicleId,
          vehicle: { make: offering.vehicle.make, model: offering.vehicle.model, modelYear: offering.vehicle.modelYear, color: offering.vehicle.color, vehicleType: offering.vehicle.vehicleType, bookablePassengerCapacity: effectiveCapacity },
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

        // 1) Provisional Booking (TOTALIZED PER_VEHICLE_DAY, billableQuantity 1 → no unit×qty; seats=1
        //    slotless-neutral; passenger count lives ONLY in the snapshot, never a billing quantity).
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
            // Server-owned provider-response deadline: an unanswered rental PENDING_PROVIDER booking
            // is auto-expired past this (releasing its dates) — client input NEVER sets it.
            providerResponseDeadlineAt: new Date(now.getTime() + RENTAL_PROVIDER_RESPONSE_HOURS * 3_600_000),
          },
          select: { id: true },
        });
        await recordBookingCreated({ bookingId: booking.id, actorType: "CUSTOMER", actorId: params.customerId }, tx);
        await transitionBooking({ bookingId: booking.id, toStatus: "PENDING_PROVIDER", actorType: "SYSTEM" }, tx);

        // 2) Claim the confirmation idempotency key IMMEDIATELY — BEFORE the hold link + child confirm.
        //    Its @@unique(customerId, idempotencyKey) SERIALIZES concurrent same-key confirmations: the
        //    loser hits P2002 here (this whole tx rolls back) and replays the winner, rather than
        //    racing the child-status guard and returning a misleading HOLD_NOT_CONFIRMABLE/expired.
        await tx.bookingIdempotencyKey.create({
          data: { customerId: params.customerId, idempotencyKey: params.confirmationIdempotencyKey, requestFingerprint, bookingId: booking.id },
        });

        // 3) GUARDED hold-group link + FINAL quote snapshot (total/currency/quoteFingerprint = B).
        //    `bookingId: null` + count===1 makes a second confirmation of an already-linked hold lose.
        const linked = await tx.rentalVehicleDayHoldGroup.updateMany({
          where: { id: group.id, customerId: params.customerId, bookingId: null },
          data: { bookingId: booking.id, totalAmount: total, currency: quote.currency, quoteFingerprint: quote.quoteFingerprint },
        });
        if (linked.count !== 1) throw new Error("RENTAL_CONFIRM_LINK_LOST");

        // 4) GUARDED per-date HELD→CONFIRMED that ALSO writes each child's FINAL amount/currency/source
        //    (= B), by exact (holdGroup, serviceDate) mapping. `expiresAt > now` loses to a concurrent
        //    expiry; the sum of affected counts MUST equal the selected-date count, else roll back.
        let confirmedCount = 0;
        for (const day of resolved) {
          const u = await tx.rentalVehicleDayReservation.updateMany({
            where: { holdGroupId: group.id, serviceDate: dbDateFromOmanDateKey(day.dateKey)!, status: "HELD", expiresAt: { gt: now } },
            data: { status: "CONFIRMED", expiresAt: null, dailyAmount: day.amount, currency: quote.currency, priceSource: day.priceSource },
          });
          confirmedCount += u.count;
        }
        if (confirmedCount !== resolved.length) throw new Error("RENTAL_CONFIRM_GUARD_MISMATCH");

        // 5) In-tx rental audit (BookingStatusEvent already records the lifecycle; this records the link).
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
      if (error instanceof Error && error.message === "RENTAL_CONFIRM_GUARD_MISMATCH") return { ok: false, reason: "HOLD_EXPIRED" };
      if (error instanceof Error && error.message === "RENTAL_CONFIRM_LINK_LOST") return { ok: false, reason: "HOLD_NOT_CONFIRMABLE" };
      if (isUniqueViolation(error)) {
        // A concurrent same-key confirmation committed first (the idempotency-key P2002), or — far less
        // likely — the child active-unique fired. Re-read the key: replay the winner, mismatch, or (if
        // the competitor rolled back, so no committed row exists) bounded-retry the whole confirmation.
        try {
          const prior = await replayConfirmationKey(prisma, params.customerId, params.confirmationIdempotencyKey, requestFingerprint);
          if ("replay" in prior) return prior.replay;
          continue; // competitor rolled back → retry (bounded)
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
  return { ok: false, reason: "VEHICLE_DATE_CONFLICT" };
}
