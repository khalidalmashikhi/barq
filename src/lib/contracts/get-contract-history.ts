import "server-only";
import type { BookingActorType, BookingContractEventType } from "@prisma/client";
import { prisma } from "@/lib/db";

// Contract History — Phase E.2, requirement #8. Mirrors
// src/lib/booking/lifecycle/get-booking-timeline.ts's role exactly:
// an ordered read of the append-only event log, excluding the raw
// actorId (actor *role* is what this requirement asks for, not an
// internal identifier — same reasoning as the Booking Timeline).

export interface ContractHistoryEntry {
  id: string;
  eventType: BookingContractEventType;
  actorType: BookingActorType;
  note: string | null;
  occurredAt: Date;
}

export async function getContractHistory(contractId: string): Promise<ContractHistoryEntry[]> {
  const events = await prisma.bookingContractEvent.findMany({
    where: { contractId },
    orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true, actorType: true, note: true, createdAt: true },
  });

  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    actorType: event.actorType,
    note: event.note,
    occurredAt: event.createdAt,
  }));
}
