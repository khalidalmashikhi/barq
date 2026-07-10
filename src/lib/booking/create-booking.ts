"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Create booking — Engineering Sprint (Booking Engine).
//
// SECURITY: nothing from the client is trusted except which serviceId/
// priceId the customer says they want. Every fact used to decide
// whether the booking is valid — the service's PUBLISHED status, the
// price's ACTIVE status and its actual amount/currency, and which
// Customer the authenticated session maps to — is re-read from the
// database inside this action, never taken from hidden form fields.
//
// Uses requireCustomer() from src/lib/auth/rbac.ts UNCHANGED — this
// sprint does not modify RBAC. If no Customer profile exists,
// requireCustomer() throws ForbiddenError, caught below and surfaced
// as a redirect to a clear "complete your profile" state rather than
// an unhandled 500 — see the booking page for how this renders.
//
// NO PAYMENT, NO COMMISSION LOGIC — explicitly out of scope this
// sprint. priceSnapshotAmount/Currency are captured at creation time
// from the validated ACTIVE Price (the only real price data available,
// since no confirmation/payment step exists yet to snapshot "at
// confirmation" as the schema comment describes — a judgment call,
// stated directly). commissionSnapshotAmount/Tier are left null.
// Booking.status is left at its schema default (CREATED) — nothing in
// this sprint moves a booking to CONFIRMED, since that transition has
// no real trigger without payments.

export type CreateBookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string };

export async function createBooking(formData: FormData): Promise<CreateBookingResult> {
  const serviceId = formData.get("serviceId");
  const priceId = formData.get("priceId");

  if (typeof serviceId !== "string" || typeof priceId !== "string") {
    return { ok: false, error: "بيانات الطلب غير صالحة" };
  }

  if (!isValidUuid(serviceId) || !isValidUuid(priceId)) {
    return { ok: false, error: "بيانات الطلب غير صالحة" };
  }

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

  // Re-read the service from the database — never trust that a
  // PUBLISHED status claimed by the client is real.
  const service = await prisma.service.findFirst({
    where: { id: serviceId, status: "PUBLISHED" },
  });

  if (!service) {
    return { ok: false, error: "هذه التجربة غير متاحة للحجز حالياً" };
  }

  // Re-read the price — must belong to THIS service and be ACTIVE.
  // Never trust an amount sent from the browser; the amount used below
  // is exactly what's stored on this row.
  const price = await prisma.price.findFirst({
    where: { id: priceId, serviceId: service.id, status: "ACTIVE" },
  });

  if (!price) {
    return { ok: false, error: "الخيار السعري المحدد غير متاح لهذه التجربة" };
  }

  const booking = await prisma.booking.create({
    data: {
      customerId: customer.id,
      serviceId: service.id,
      providerId: service.providerId,
      priceSnapshotAmount: price.amount,
      priceSnapshotCurrency: price.currency,
    },
  });

  return { ok: true, bookingId: booking.id };
}
