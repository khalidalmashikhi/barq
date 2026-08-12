import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Admin Service detail query — Phase 2.3 (Service Foundation). Returns
// raw bilingual Json for name/description (not locale-extracted), same
// distinction get-provider-detail.ts already draws against
// get-providers.ts's list view — this feeds an admin edit form that
// needs both languages simultaneously. providerName is locale-extracted
// since it is read-only display context, not an editable field.
//
// Distinct from the pre-existing public
// src/lib/services/get-service-detail.ts's getServiceById(), which is
// hardcoded to status: PUBLISHED — this returns a Service at any
// status, for admin management.

export type ServiceDetail = {
  id: string;
  providerId: string;
  providerName: string;
  serviceType: string;
  categoryId: string | null;
  // Discovery region (Gate 3) — raw governed CODE or null; not localized. Feeds the
  // admin edit form's future region field; no presentation applied here.
  regionCode: string | null;
  name: { ar: string; en: string };
  description: { ar: string; en: string } | null;
  status: string;
  // pricingUnit rides the SAME ACTIVE price row as amount/currency; display
  // metadata only (never affects totals/booking); null-tolerant for legacy rows.
  activePrice: { amount: string; currency: string; pricingUnit: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
} | null;

export async function getServiceDetail(serviceId: string): Promise<ServiceDetail> {
  await requireAdmin();

  if (!isValidUuid(serviceId)) {
    return null;
  }

  const locale = await getLocale();

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });

  if (!service) {
    return null;
  }

  return {
    id: service.id,
    providerId: service.providerId,
    providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    serviceType: service.serviceType,
    categoryId: service.categoryId,
    regionCode: service.regionCode ?? null,
    name: service.name as { ar: string; en: string },
    description: service.description as { ar: string; en: string } | null,
    status: service.status,
    activePrice: service.prices[0]
      ? { amount: String(service.prices[0].amount), currency: service.prices[0].currency, pricingUnit: service.prices[0].pricingUnit ?? null }
      : null,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}
