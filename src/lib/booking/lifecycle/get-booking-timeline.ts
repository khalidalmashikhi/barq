import "server-only";
import type { BookingActorType, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Booking Lifecycle Engine — Phase E.1. Shared query backing three of
// this phase's requirements at once, all reading the same
// BookingStatusEvent rows: the Booking Timeline (#5 — a booking's own
// ordered, timestamped history), the Booking History API (#6 —
// src/app/api/bookings/[id]/history/route.ts exposes this same data
// over HTTP), and the Booking Activity Log (#7 — who/when/what,
// satisfied by actorType + toStatus + occurredAt below).
//
// Deliberately excludes the raw actorId from this DTO: actorType
// (CUSTOMER/PROVIDER/SYSTEM/ADMIN) already answers "who" at the
// granularity these requirements ask for, without handing back an
// internal Customer/Provider/User UUID to whoever can read a booking's
// timeline — consistent with "no sensitive data" (#7).

export interface BookingTimelineEntry {
  id: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorType: BookingActorType;
  reason: string | null;
  occurredAt: Date;
}

export async function getBookingTimeline(bookingId: string): Promise<BookingTimelineEntry[]> {
  const events = await prisma.bookingStatusEvent.findMany({
    where: { bookingId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      actorType: true,
      reason: true,
      createdAt: true,
    },
  });

  return events.map((event) => ({
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorType: event.actorType,
    reason: event.reason,
    occurredAt: event.createdAt,
  }));
}
