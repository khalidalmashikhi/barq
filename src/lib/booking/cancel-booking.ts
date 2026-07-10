"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Cancel booking — Engineering Sprint (Booking Engine).
//
// Uses existing CANCELLED value from BookingStatus — no new enum
// value, no schema change. Deliberately conservative: only bookings in
// CREATED or CONFIRMED can be cancelled (not already CANCELLED,
// COMPLETED, DISPUTED, or IN_PROGRESS). No cancellation-window rule
// (e.g. "24 hours before") is invented — nothing in this project's
// documentation specifies one; adding one here would be inventing
// business logic, not just data wiring.
//
// SECURITY: ownership is re-verified from the database, not trusted
// from any client-supplied claim — the booking's actual customerId is
// compared against the authenticated user's actual Customer.id.

export type CancelBookingResult = { ok: true } | { ok: false; error: string };

const CANCELLABLE_STATUSES = ["CREATED", "CONFIRMED"];

export async function cancelBooking(bookingId: string): Promise<CancelBookingResult> {
  if (!isValidUuid(bookingId)) {
    return { ok: false, error: "معرّف الحجز غير صالح" };
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

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  // Ownership re-verified from the database — not trusted from any
  // client claim. A mismatch is treated identically to "not found,"
  // not surfaced as 403, to avoid confirming another customer's
  // booking ID exists.
  if (!booking || booking.customerId !== customer.id) {
    return { ok: false, error: "الحجز غير موجود" };
  }

  if (!CANCELLABLE_STATUSES.includes(booking.status)) {
    return { ok: false, error: "لا يمكن إلغاء هذا الحجز في حالته الحالية" };
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "CANCELLED" },
  });

  return { ok: true };
}
