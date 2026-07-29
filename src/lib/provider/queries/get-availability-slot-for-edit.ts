import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";

// Availability Slot (edit form) query — Phase 4.2 (Provider
// Experience). Same ownership/not-found convention as
// getProviderServiceForEdit(): queries by both slotId and the
// authenticated provider.id (via the Service relation), returns null
// uniformly for malformed id / missing slot / another provider's slot.

export type AvailabilitySlotForEdit = {
  id: string;
  serviceId: string;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  bookedCount: number;
  state: string;
};

export async function getAvailabilitySlotForEdit(slotId: string): Promise<AvailabilitySlotForEdit | null> {
  if (!isValidUuid(slotId)) return null;

  const { provider } = await requireProvider();
  const locale = await getLocale();

  const slot = await prisma.availability.findFirst({
    where: { id: slotId, service: { providerId: provider.id } },
    include: { service: true },
  });

  if (!slot) return null;

  type SlotRow = typeof slot & { service: { name: unknown } };
  const row = slot as SlotRow;

  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: extractLocalizedText(row.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    startTime: row.startTime,
    endTime: row.endTime,
    capacity: row.capacity,
    bookedCount: row.bookedCount,
    state: row.state,
  };
}
