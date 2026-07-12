import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";

// Available slots query — Engineering Sprint (Availability Engine).
//
// Only OPEN, future, non-full slots are returned — BLOCKED and
// CANCELLED are excluded by the query itself, and "full" (bookedCount
// >= capacity) is filtered in application code, since Prisma's filter
// DSL cannot compare two columns directly (the same limitation
// documented in create-booking.ts's guarded UPDATE). This is a
// read-only display list, not a concurrency-sensitive write, so
// filtering in application code here is safe — the real capacity
// guard lives in the atomic UPDATE at booking time, not here.

export type AvailableSlot = {
  id: string;
  startTime: Date;
  endTime: Date;
  remainingSeats: number;
};

export async function getAvailableSlots(serviceId: string): Promise<AvailableSlot[]> {
  if (!isValidUuid(serviceId)) return [];

  const slots = await prisma.availability.findMany({
    where: {
      serviceId,
      state: "OPEN",
      startTime: { gt: new Date() },
    },
    orderBy: { startTime: "asc" },
  });

  type SlotRow = { id: string; startTime: Date; endTime: Date; capacity: number; bookedCount: number };

  return (slots as SlotRow[])
    .map((slot) => ({
      id: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      remainingSeats: slot.capacity - slot.bookedCount,
    }))
    .filter((slot) => slot.remainingSeats > 0);
}
