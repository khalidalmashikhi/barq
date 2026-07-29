import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Provider Service picker options — Phase 4.2 (Provider Experience).
// A small, unpaginated list of {id, name} for the Create/Bulk-Create
// Availability forms' service <select> — deliberately not
// getProviderServices() (that DTO carries pagination/price/status
// fields this picker doesn't need). Excludes ARCHIVED services: an
// archived experience should not be offered as a target for new
// availability slots.

export type ProviderServiceOption = {
  id: string;
  name: string;
};

export async function getProviderServiceOptions(): Promise<ProviderServiceOption[]> {
  const { provider } = await requireProvider();
  const locale = await getLocale();

  const services = await prisma.service.findMany({
    where: { providerId: provider.id, status: { not: "ARCHIVED" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  type ServiceRow = { id: string; name: unknown };

  return (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
  }));
}
