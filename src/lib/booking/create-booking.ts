"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import type { BookingActionErrorCode } from "./booking-action-errors";

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

  // seats defaults to 1 if not provided (matches the schema default),
  // but is always re-validated as a positive integer regardless of
  // what the client sent.
  const seatsParsed = typeof seatsRaw === "string" ? parseInt(seatsRaw, 10) : 1;
  const seats = Number.isInteger(seatsParsed) && seatsParsed > 0 ? seatsParsed : 1;

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

  const service = await prisma.service.findFirst({
    where: { id: serviceId, status: "PUBLISHED" },
  });

  if (!service) {
    return { ok: false, error: "SERVICE_UNAVAILABLE" };
  }

  const price = await prisma.price.findFirst({
    where: { id: priceId, serviceId: service.id, status: "ACTIVE" },
  });

  if (!price) {
    return { ok: false, error: "PRICE_UNAVAILABLE" };
  }

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
  }

  try {
    const bookingId = await prisma.$transaction(async (tx) => {
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
        },
      });

      return booking.id;
    });

    return { ok: true, bookingId };
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_FULL") {
      return { ok: false, error: "SLOT_FULL" };
    }
    // Genuinely unexpected — never expose Prisma/internal exception
    // details to the client; log server-side only and return the
    // generic code.
    console.error("[createBooking] unexpected error", error);
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
