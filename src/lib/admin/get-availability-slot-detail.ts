import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Admin Availability detail query — Phase 2.7 (Availability
// Foundation). Mirrors get-availability-slot-for-edit.ts's shape, minus
// the provider-ownership scope: an admin may view/manage any slot.

export type AvailabilitySlotDetail = {
  id: string;
  serviceId: string;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  state: string;
  capacity: number;
  bookedCount: number;
  remainingSeats: number;
  createdAt: Date;
  updatedAt: Date;
} | null;

export async function getAvailabilitySlotDetail(slotId: string): Promise<AvailabilitySlotDetail> {
  await requireAdmin();

  if (!isValidUuid(slotId)) {
    return null;
  }

  const locale = await getLocale();

  const slot = await prisma.availability.findUnique({
    where: { id: slotId },
    include: { service: true },
  });

  if (!slot) {
    return null;
  }

  return {
    id: slot.id,
    serviceId: slot.serviceId,
    serviceName: extractLocalizedText(slot.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    startTime: slot.startTime,
    endTime: slot.endTime,
    state: slot.state,
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
    remainingSeats: Math.max(0, slot.capacity - slot.bookedCount),
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
}
