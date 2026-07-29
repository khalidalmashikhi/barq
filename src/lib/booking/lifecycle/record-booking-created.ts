import "server-only";
import type { BookingActorType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Booking Lifecycle Engine — Phase E.1. The initial timeline/history
// entry for a Booking (fromStatus: null -> CREATED), written once, at
// creation time. Kept separate from transitionBooking() rather than
// forcing that function to handle a "from nothing" case: the booking
// row does not exist yet at creation time, so there is no prior status
// to read or validate against — this is structurally a different
// operation (an insert-time side record), not a transition.
//
// Accepts the same optional external transaction client pattern as
// transitionBooking(), so create-booking.ts can include this write in
// its existing single-transaction booking-creation flow.

export interface RecordBookingCreatedParams {
  bookingId: string;
  actorType: BookingActorType;
  actorId?: string;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function recordBookingCreated(
  params: RecordBookingCreatedParams,
  db: DbClient = prisma
): Promise<void> {
  await db.bookingStatusEvent.create({
    data: {
      bookingId: params.bookingId,
      fromStatus: null,
      toStatus: "CREATED",
      actorType: params.actorType,
      actorId: params.actorId ?? null,
    },
  });
}
