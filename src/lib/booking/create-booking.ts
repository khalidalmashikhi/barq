"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isCustomerCompleteForAction } from "@/lib/auth/require-complete-customer";
import { isValidUuid } from "@/lib/uuid";
import { recordBookingCreated, transitionBooking } from "@/lib/booking/lifecycle";
import { dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import { serviceRequiresSlot } from "@/lib/booking/service-requires-slot";
import { getBookingCreateRateLimit } from "@/lib/rate-limit/rate-limit-config";
import { calculateBookingTotal } from "@/lib/booking/pricing/calculate-booking-total";
import { parseBookingQuantity } from "@/lib/booking/parse-booking-quantity";
import { readIdempotencyKey, computeBookingRequestFingerprint } from "@/lib/booking/idempotency";
import type { BookingActionErrorCode } from "./booking-action-errors";

// A unique-constraint violation (P2002) can now come from TWO distinct indexes on the creation
// transaction, which MUST be told apart:
//   • booking_idempotency_keys (customerId, idempotencyKey) — a concurrent same-key request
//     (BOOKING-IDEMPOTENCY): re-read and replay/conflict.
//   • bookings_active_slot_per_customer_key (customerId, availabilityId) WHERE ... — a concurrent
//     DIFFERENT-key request for the same slot (SLOT BUSINESS-DUPLICATE): the existing DUPLICATE_BOOKING.
// This returns the P2002 target (index name or field list, joined) for that discrimination, or null
// when the error is not a unique violation. The constraint/index NAME never leaves this module.
function uniqueViolationTarget(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.join(",");
  if (typeof target === "string") return target;
  return ""; // a P2002 with no usable target — still a unique violation, just unnamed.
}

// Create booking — Engineering Sprint (Availability Engine).
//
// SECURITY, unchanged principle from the original Booking Engine
// sprint: nothing from the client is trusted except which IDs were
// selected. Service PUBLISHED status, Price ACTIVE-and-belongs-to-
// service, Availability belongs-to-service/is-OPEN/is-in-the-future,
// and the authenticated Customer are all re-read from the database
// here — never taken from hidden form fields, including seats and
// which slot was picked.
//
// CONCURRENCY STRATEGY (Entry 067's design, now implemented):
// The capacity guard is a single atomic conditional UPDATE — not a
// separate read-then-write. Prisma's query filter DSL cannot express
// "bookedCount + seats <= capacity" (a comparison between two columns
// plus a parameter) — that requires raw SQL, which is why $executeRaw
// is used for this one statement specifically, inside the same
// $transaction as the Booking creation. PostgreSQL's row-level locking
// under MVCC serializes concurrent UPDATEs against the same
// Availability row: a second concurrent request's guarded UPDATE
// re-evaluates its WHERE clause against the post-commit value of the
// first, so it is structurally impossible for two concurrent requests
// to both push bookedCount past capacity, regardless of load. If the
// guarded UPDATE affects 0 rows, capacity genuinely wasn't available —
// the transaction is aborted (thrown, not committed) and no Booking
// row is created.
//
// A slot is entirely optional here: if a service has no Availability
// rows at all, booking proceeds exactly as it did before this sprint
// (availabilityId stays null) — this sprint does not force every
// service to use slots, preserving the existing Booking Engine's
// behavior for services that never adopt scheduling.
//
// INTERNATIONALIZATION PHASE A.4: every error return is now a stable,
// locale-neutral BookingActionErrorCode, never localized text — the
// calling page resolves a code to a translated message via
// booking-error-messages.ts's mapping layer. Genuinely unexpected
// exceptions are caught and logged server-side only (never exposing
// Prisma/internal exception details to the client) before returning
// the generic UNKNOWN_ERROR code.

export type CreateBookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: BookingActionErrorCode };

export async function createBooking(formData: FormData): Promise<CreateBookingResult> {
  const serviceId = formData.get("serviceId");
  const priceId = formData.get("priceId");
  const availabilityIdRaw = formData.get("availabilityId");
  const seatsRaw = formData.get("seats");

  if (typeof serviceId !== "string" || typeof priceId !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (!isValidUuid(serviceId) || !isValidUuid(priceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // availabilityId is optional — a service with no slots at all is
  // still bookable without one, per the existing Booking Engine's
  // design.
  const availabilityId =
    typeof availabilityIdRaw === "string" && availabilityIdRaw.length > 0 ? availabilityIdRaw : null;
  if (availabilityId !== null && !isValidUuid(availabilityId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Booking quantity — MISSING (no seats key) defaults to 1 (the existing contract: slotless
  // services never submit it); an explicitly-supplied invalid value (empty, 0, negative,
  // fractional, non-numeric, unsafe-large) FAILS CLOSED rather than being coerced to 1. Same
  // strict parser for web and API v1 (both go through this seam). Service-specific
  // min/maxBookingSeats bounds are still enforced below.
  const quantity = parseBookingQuantity(seatsRaw);
  if (!quantity.ok) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const seats = quantity.value;

  // BOOKING-IDEMPOTENCY — the optional client idempotency key + the server-side request
  // fingerprint. The key is opaque/untrusted (validated for shape only); the fingerprint is
  // derived from the VALIDATED selectors ONLY (serviceId/priceId/availabilityId/seats — never
  // client-supplied money), so the same key reused for a materially different request conflicts.
  // Absent key = no idempotency protection (backward compatible, e.g. an older API client); a
  // malformed key fails closed before any work.
  const idempotency = readIdempotencyKey(formData.get("idempotencyKey"));
  if (idempotency.state === "invalid") {
    return { ok: false, error: "IDEMPOTENCY_KEY_INVALID" };
  }
  const requestFingerprint = computeBookingRequestFingerprint({ serviceId, priceId, availabilityId, seats });

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

  // BOOKING-IDEMPOTENCY — pre-transaction fast path for the SEQUENTIAL retry (the original attempt
  // already committed). Scoped to THIS customer, so a key can only ever surface this customer's own
  // booking — never another customer's (§17). Same key + same fingerprint → REPLAY the original
  // booking, with zero repeated side effects (no capacity, lifecycle, notification, commission, or
  // payment). Same key + different fingerprint → CONFLICT. The truly CONCURRENT race (neither
  // request committed yet) is instead arbitrated by the unique index inside the transaction below.
  // Checked before the rate limit so a legitimate retry never burns a booking-rate token for a
  // booking that already exists.
  if (idempotency.state === "valid") {
    const existing = await prisma.bookingIdempotencyKey.findUnique({
      where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey: idempotency.key } },
    });
    if (existing) {
      if (existing.requestFingerprint === requestFingerprint) {
        return { ok: true, bookingId: existing.bookingId };
      }
      return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };
    }
  }

  // AUTH-DUAL-VERIFICATION-1 — a customer must have BOTH a verified phone and a
  // verified real email before booking. Same central authority as the page guards; no
  // ad-hoc credential check here, and the rule itself is unchanged.
  //
  // PLATFORM-CUSTOMER-CREDENTIALS-API-1 — this used to REDIRECT. createBooking() is
  // shared by the Web form and by POST /api/v1/me/bookings, and a redirect is a
  // browser instruction: the native client received a thrown NEXT_REDIRECT instead of
  // an answer. It now returns a domain error, and each transport presents it its own
  // way — Web still redirects at the layout and book page before the form is ever
  // shown, so a browser cannot normally reach this branch at all.
  if (!(await isCustomerCompleteForAction())) {
    return { ok: false, error: "CUSTOMER_INCOMPLETE" };
  }

  // Production Hardening — Rate Limiting. Keyed on the authenticated
  // customer's own id (mirrors this codebase's existing OTP rate limits
  // keying on the identity being protected, not the request's IP —
  // see check-resend-cooldown.ts/check-daily-send-limit.ts), so this
  // guards against a single account scripting repeated bookings, not
  // against distinct legitimate customers sharing a NAT/proxy IP.
  // Checked only after authentication succeeds — an unauthenticated
  // caller can never consume another customer's bucket.
  const rateLimit = checkRateLimit(`booking-create:${customer.id}`, getBookingCreateRateLimit());
  if (!rateLimit.allowed) {
    logger.warn("createBooking.rate_limited", { customerId: customer.id, retryAfterSeconds: rateLimit.retryAfterSeconds });
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Production Blocker fix — this re-fetch previously trusted
  // Service.status alone, never re-checking the provider's own
  // status/visibility. A provider archived (DEACTIVATED) after
  // publishing a service kept every one of their services fully
  // bookable through this action indefinitely — matches this file's
  // own stated principle ("nothing from the client is trusted... always
  // re-read from the database here") by re-reading provider status too,
  // the same gate get-service-detail.ts's getServiceById() and
  // get-services.ts's listing query already apply.
  const service = await prisma.service.findFirst({
    where: { id: serviceId, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
  });

  if (!service) {
    return { ok: false, error: "SERVICE_UNAVAILABLE" };
  }

  // BOOKING-SLOT-AUTHORITY — a slot-based service may NEVER be booked without a slot.
  //
  // THIS CLOSES A CAPACITY-BYPASS PATH, not merely a contract inconsistency. The
  // atomic `bookedCount + seats <= capacity` guard below runs ONLY when an
  // availabilityId is present, so before this check a request that simply omitted one
  // produced a real, confirmed booking against a slot-based service while consuming
  // zero capacity — overbooking that no seat count could see. The rule was previously
  // enforced only by the web form's HTML `required`, i.e. not enforced at all.
  //
  // Derived SERVER-SIDE from the same single authority the read surfaces use; nothing
  // about it is accepted from the client. Returning here — before the transaction —
  // guarantees zero Booking rows, zero capacity mutation, zero lifecycle events and
  // zero provider notification on rejection.
  //
  // The empty string is treated as absent above, so "" lands here rather than failing
  // the UUID check with a less accurate INVALID_INPUT.
  if (availabilityId === null && (await serviceRequiresSlot(service.id))) {
    return { ok: false, error: "SLOT_REQUIRED" };
  }

  const price = await prisma.price.findFirst({
    where: { id: priceId, serviceId: service.id, status: "ACTIVE" },
  });

  if (!price) {
    return { ok: false, error: "PRICE_UNAVAILABLE" };
  }

  // SERVICE INFORMATION MODEL — per-BOOKING seat bounds set by the provider for this service.
  // These are the customer's requestable quantity range (NOT the slot's total capacity, which
  // the atomic guard below still enforces independently). Server-authoritative; the booking
  // form mirrors these as the seats input's min/max. Both bounds are optional; a NULL bound
  // imposes nothing. Checked before the transaction so a rejection creates no rows/events.
  if (service.minBookingSeats !== null && seats < service.minBookingSeats) {
    return { ok: false, error: "BOOKING_QUANTITY_OUT_OF_RANGE" };
  }
  if (service.maxBookingSeats !== null && seats > service.maxBookingSeats) {
    return { ok: false, error: "BOOKING_QUANTITY_OUT_OF_RANGE" };
  }

  // BOOKING TOTAL CALCULATION — compute the authoritative booking total from the SERVER-read
  // price + validated seats, BEFORE the transaction (so a pricing failure creates no rows and,
  // per §23, never mutates capacity). The calculator is the sole pricing authority; nothing
  // here re-derives a total. seats is the quantity INPUT — the calculator decides the billable
  // multiplier per unit (× seats for PER_PERSON, × 1 for the fixed units). Deterministic, so
  // computing here and persisting inside the tx is safe.
  const pricing = calculateBookingTotal({
    unitAmount: price.amount,
    currency: price.currency,
    pricingUnit: price.pricingUnit ?? "",
    bookingQuantity: seats,
  });
  if (!pricing.ok) {
    // FAIL CLOSED — the unit price is NEVER substituted as a total.
    //  - UNSUPPORTED_BILLABLE_DURATION (PER_DAY/PER_HOUR) and UNKNOWN_PRICING_UNIT (an
    //    unrecognized or NULL unit): a generic, customer-safe "not bookable yet" — no internal
    //    calculator code leaks. UNKNOWN also signals a mis-configured price, so log it.
    //  - INVALID_UNIT_AMOUNT: a corrupt stored price (should not occur for a validated Price);
    //    fail closed as PRICE_UNAVAILABLE.
    //  - INVALID_QUANTITY: unreachable (seats is already a validated positive integer above);
    //    mapped defensively to INVALID_INPUT.
    if (pricing.error === "UNKNOWN_PRICING_UNIT" || pricing.error === "INVALID_UNIT_AMOUNT") {
      logger.warn("createBooking.unpriceable", { serviceId: service.id, priceId: price.id, reason: pricing.error });
    }
    const errorCode: BookingActionErrorCode =
      pricing.error === "UNSUPPORTED_BILLABLE_DURATION" || pricing.error === "UNKNOWN_PRICING_UNIT"
        ? "PRICING_UNIT_NOT_BOOKABLE"
        : pricing.error === "INVALID_UNIT_AMOUNT"
          ? "PRICE_UNAVAILABLE"
          : "INVALID_INPUT";
    return { ok: false, error: errorCode };
  }

  // BOOKING-INTERVAL-1 — for a slot-based booking, the operational interval is snapshotted
  // from the selected Availability here at create (both instants, or neither). Slot times are
  // frozen once a booking references the slot, but snapshotting onto the Booking makes the
  // interval historically stable regardless, and unifies slot-based with the slotless path
  // (which gets its interval from the provider at acceptance). Slotless bookings keep it null.
  let slotInterval: { startsAt: Date; endsAt: Date } | null = null;

  // If a slot was selected, re-validate it belongs to this service, is
  // OPEN, and is in the future — never trust the client's claim about
  // any of these, even though the ID itself came from a legitimate
  // selection in the UI.
  if (availabilityId !== null) {
    const availability = await prisma.availability.findFirst({
      where: {
        id: availabilityId,
        serviceId: service.id,
        state: "OPEN",
        startTime: { gt: new Date() },
      },
    });

    if (!availability) {
      return { ok: false, error: "SLOT_UNAVAILABLE" };
    }

    // Server-derived from the authoritative slot — never from client-supplied start/end.
    slotInterval = { startsAt: availability.startTime, endsAt: availability.endTime };

    // Duplicate-booking prevention (Phase C.3 Group 1): the same
    // customer creating a second, active booking for the exact same
    // slot has no legitimate use case distinct from "increase seats"
    // on their existing booking (already supported by the `seats`
    // field above) — this guards against the ordinary double-submit
    // case (double-click, a retried request after a slow response).
    // Best-effort, not atomic: like the capacity guard before Entry
    // 067 introduced the raw-SQL UPDATE, this is a plain read-then-act
    // check, not a database-level constraint, so two truly simultaneous
    // requests from the same customer could theoretically both pass it.
    // A schema-level unique constraint on (customerId, availabilityId)
    // would close that gap but is a Prisma schema change, out of this
    // phase's low-risk scope — documented as a follow-up, not
    // implemented here. Scoped to slot-based bookings only: a
    // slot-less service has no natural "same booking" concept to
    // dedupe against, and repeat bookings there may be legitimate.
    const existingBooking = await prisma.booking.findFirst({
      where: {
        customerId: customer.id,
        availabilityId,
        status: { not: "CANCELLED" },
      },
    });

    if (existingBooking) {
      return { ok: false, error: "DUPLICATE_BOOKING" };
    }
  }

  try {
    const { bookingId, hookContext } = await prisma.$transaction(async (tx) => {
      if (availabilityId !== null) {
        // The atomic guard — see the concurrency note above for why
        // this must be raw SQL and why it is safe under concurrent load.
        const affectedRows: number = await tx.$executeRaw`
          UPDATE availabilities
          SET "bookedCount" = "bookedCount" + ${seats}
          WHERE id = ${availabilityId}::uuid
            AND state = 'OPEN'
            AND "bookedCount" + ${seats} <= capacity
        `;

        if (affectedRows === 0) {
          // Someone else took the remaining capacity between our read
          // above and this transaction — a genuine race, correctly
          // caught, not a bug. Abort by throwing inside the
          // transaction callback; Prisma rolls back automatically.
          throw new Error("SLOT_FULL");
        }
      }

      const booking = await tx.booking.create({
        data: {
          customerId: customer.id,
          serviceId: service.id,
          providerId: service.providerId,
          seats,
          availabilityId,
          priceSnapshotAmount: price.amount,
          priceSnapshotCurrency: price.currency,
          // BOOKING TOTAL CALCULATION — the authoritative, immutable pricing snapshot, written
          // ATOMICALLY with the booking (never patched afterwards). priceSnapshotAmount stays the
          // UNIT price; these three add the totalized model. bookingTotalSnapshot is the Decimal
          // total straight from the calculator (no Decimal→Number→Decimal round-trip). A future
          // Price edit must never be re-read to recompute this historical total.
          pricingUnitSnapshot: pricing.value.pricingUnit,
          billableQuantitySnapshot: pricing.value.billableQuantity,
          bookingTotalSnapshot: pricing.value.total,
          // BOOKING-INTERVAL-1 — slot-based bookings carry the operational interval from
          // create; slotless bookings stay null until the provider schedules at acceptance.
          ...(slotInterval
            ? { operationalStartAt: slotInterval.startsAt, operationalEndAt: slotInterval.endsAt }
            : {}),
        },
      });

      // Phase E.1 (Booking Lifecycle Engine): the first Booking Timeline
      // entry, written in the same transaction as the booking itself so
      // a booking can never exist without at least one history row.
      await recordBookingCreated({ bookingId: booking.id, actorType: "CUSTOMER", actorId: customer.id }, tx);

      // Phase 4.1: CREATED is a real but momentary status — every new
      // booking immediately advances to PENDING_PROVIDER inside this
      // same transaction, so a booking is never observed sitting at
      // plain CREATED in normal operation. The hook (provider
      // notification) fires only after this transaction actually
      // commits — see the dispatchLifecycleHook call below.
      const hookContext = await transitionBooking(
        { bookingId: booking.id, toStatus: "PENDING_PROVIDER", actorType: "SYSTEM" },
        tx
      );

      // BOOKING-IDEMPOTENCY — claim the key LAST, inside the same transaction. Its
      // @@unique([customerId, idempotencyKey]) is the sole race arbiter: two concurrent same-key
      // requests both reach here, but only one INSERT can commit — the loser hits P2002 and this
      // whole transaction (booking row + capacity increment) rolls back, so a duplicate submission
      // yields exactly ONE booking and consumes capacity once. Inserting it LAST (not first) means
      // a booking that fails capacity/pricing earlier never claims the key, so the key stays
      // reusable after a genuinely failed attempt (§15). Skipped entirely when no key was supplied.
      if (idempotency.state === "valid") {
        await tx.bookingIdempotencyKey.create({
          data: {
            customerId: customer.id,
            idempotencyKey: idempotency.key,
            requestFingerprint,
            bookingId: booking.id,
          },
        });
      }

      return { bookingId: booking.id, hookContext };
    });

    // Fired only after the transaction above has actually committed —
    // see transition-booking.ts's own comment for why this must happen
    // out here, not inside transitionBooking() itself.
    await dispatchLifecycleHook(hookContext);

    return { ok: true, bookingId };
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_FULL") {
      return { ok: false, error: "SLOT_FULL" };
    }
    // A unique-constraint violation from inside the transaction — which index decides the meaning.
    const uniqueTarget = uniqueViolationTarget(error);
    if (uniqueTarget !== null) {
      // The idempotency index carries "idempotency" in its name/fields; the business-duplicate
      // index carries "availabilityId" (or "active_slot"). These are mutually exclusive markers.
      const hitsIdempotency = uniqueTarget.includes("idempotency");
      const hitsBusinessDuplicate = uniqueTarget.includes("availabilityId") || uniqueTarget.includes("active_slot");

      // SLOT BUSINESS-DUPLICATE — the DB rejected a SECOND active booking for this (customer, slot),
      // created by a concurrent DIFFERENT-key request. The whole transaction (booking row + capacity
      // increment + any idempotency claim) has rolled back. Map to the EXISTING stable domain error;
      // the constraint/index name never leaks. The violation occurs at booking.create — BEFORE the
      // idempotency claim — so the losing key is never persisted (§10).
      if (hitsBusinessDuplicate && !hitsIdempotency) {
        return { ok: false, error: "DUPLICATE_BOOKING" };
      }

      // BOOKING-IDEMPOTENCY — the CONCURRENT same-key race: our in-transaction claim lost to a
      // simultaneous request that committed the same (customerId, idempotencyKey) first. Re-read the
      // committed winner and REPLAY (fingerprint match) or report a CONFLICT.
      if (idempotency.state === "valid" && hitsIdempotency && !hitsBusinessDuplicate) {
        const winner = await prisma.bookingIdempotencyKey.findUnique({
          where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey: idempotency.key } },
        });
        if (winner) {
          if (winner.requestFingerprint === requestFingerprint) {
            return { ok: true, bookingId: winner.bookingId };
          }
          return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };
        }
        // The winner rolled back after we observed the conflict (extremely unlikely) — fall through.
      }

      // No key was supplied, so the ONLY unique this transaction can violate is the business-duplicate
      // slot index — even if the target came back unnamed. It is a duplicate booking, never a 500.
      if (idempotency.state !== "valid") {
        return { ok: false, error: "DUPLICATE_BOOKING" };
      }
    }
    // Genuinely unexpected — never expose Prisma/internal exception
    // details to the client; log server-side only and return the
    // generic code. Phase D.3: routed through the shared structured
    // logger, and only error.message (never the full exception object
    // — no stack trace, no Prisma error target/values) is captured, per
    // this codebase's "no sensitive data in logs" standard.
    logger.error("createBooking.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
