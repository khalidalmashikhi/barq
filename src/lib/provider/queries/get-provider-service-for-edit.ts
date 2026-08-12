import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Provider Service (edit form) query — Phase 4.2 (Provider Experience).
//
// Distinct from getProviderServiceDetail(): that DTO runs bilingual
// Json fields through extractText() (which only ever surfaces the
// "ar" value — a documented, pre-existing limitation of that shared
// helper, out of this phase's scope to fix). An edit form must let a
// provider see and change BOTH language values, since Service.name/
// description are bilingual-required fields per DATABASE_DESIGN.md §5 —
// silently dropping "en" here would leave every edited service with
// stale or missing English content compared to every other row in the
// database. This query reads the raw Json fields directly instead.
//
// Same ownership/not-found convention as getProviderServiceDetail():
// queries by both serviceId and the authenticated provider.id, returns
// null uniformly for malformed id / missing service / another
// provider's service.

export type ProviderServiceForEdit = {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  status: string;
  serviceType: string;
  categoryId: string | null;
  // Discovery/display metadata (Gate 3) — raw governed CODES or null, never
  // localized; the edit form pre-fills its region/pricing-unit fields from these.
  // pricingUnit comes from the current ACTIVE price and is display metadata only
  // (never affects totals/booking). Both null-tolerant for legacy/unset rows.
  regionCode: string | null;
  pricingUnit: string | null;
};

function readBilingual(value: unknown): { ar: string; en: string } {
  if (value && typeof value === "object") {
    const obj = value as { ar?: unknown; en?: unknown };
    return {
      ar: typeof obj.ar === "string" ? obj.ar : "",
      en: typeof obj.en === "string" ? obj.en : "",
    };
  }
  return { ar: "", en: "" };
}

export async function getProviderServiceForEdit(serviceId: string): Promise<ProviderServiceForEdit | null> {
  if (!isValidUuid(serviceId)) return null;

  const { provider } = await requireProvider();

  const service = await prisma.service.findFirst({
    where: { id: serviceId, providerId: provider.id },
    // Same ACTIVE-price selection as the other service readers, so the edit form's
    // pricingUnit comes from the exact row that carries the displayed amount.
    include: { prices: { where: { status: "ACTIVE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
  });

  if (!service) return null;

  const name = readBilingual(service.name);
  const description = readBilingual(service.description);

  return {
    id: service.id,
    nameAr: name.ar,
    nameEn: name.en,
    descriptionAr: description.ar,
    descriptionEn: description.en,
    status: service.status,
    serviceType: service.serviceType,
    categoryId: service.categoryId,
    regionCode: service.regionCode ?? null,
    pricingUnit: service.prices[0]?.pricingUnit ?? null,
  };
}
