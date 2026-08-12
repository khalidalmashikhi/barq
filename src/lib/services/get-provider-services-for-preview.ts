import "server-only";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { ServiceListItem } from "./get-services";

// Unified Preview System (provider row) — PUBLISHED-only service read for the
// provider-profile preview. Returns the SAME ServiceListItem shape the public
// storefront grid uses, scoped to { providerId, status: PUBLISHED }, but
// WITHOUT the provider APPROVED+visible gate that getServices() applies.
//
// This shows exactly what customers WILL see once the storefront is public:
// - APPLIED/UNDER_REVIEW providers cannot publish (requireApprovedProvider), so
//   this is legitimately empty for them.
// - An APPROVED-but-visible=false provider sees their published services.
// It NEVER returns DRAFT/PAUSED/ARCHIVED services (status: "PUBLISHED" only),
// so no unpublished service can leak through the preview. It does NOT touch or
// weaken the public getServices() reader (a separate, deliberately-narrow read).
// Authorization (provider self-context / admin RBAC) is enforced by the caller.

const PREVIEW_PAGE_SIZE = 12;

type ServiceRow = {
  id: string;
  name: unknown;
  providerId: string;
  regionCode?: string | null;
  provider: { businessName: unknown };
  prices: Array<{ amount: unknown; currency: string; pricingUnit?: string | null }>;
  mediaAssets: Array<{ url: string }>;
  createdAt: Date;
};

export type ProviderServicesPreviewResult = {
  items: ServiceListItem[];
  page: number;
  totalPages: number;
};

export async function getProviderPublishedServicesForPreview(
  providerId: string,
  page = 1
): Promise<ProviderServicesPreviewResult> {
  const locale = await getLocale();
  const currentPage = Math.max(1, page);
  const where = { providerId, status: "PUBLISHED" as const };

  const [totalCount, services] = await Promise.all([
    prisma.service.count({ where }),
    prisma.service.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PREVIEW_PAGE_SIZE,
      take: PREVIEW_PAGE_SIZE,
      include: {
        provider: true,
        prices: { where: { status: "ACTIVE" }, take: 1 },
        mediaAssets: { where: { kind: "COVER" }, take: 1, select: { url: true } },
      },
    }),
  ]);

  const items: ServiceListItem[] = (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerId: service.providerId,
    providerName:
      extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    // Same Gate-3 exposure as the public getServices() reader (identical shape):
    // regionCode is a Service scalar; pricingUnit rides the same ACTIVE price row.
    regionCode: service.regionCode ?? null,
    pricingUnit: service.prices[0] ? (service.prices[0].pricingUnit ?? null) : null,
    coverUrl: service.mediaAssets[0]?.url ?? null,
    createdAt: service.createdAt,
  }));

  return {
    items,
    page: currentPage,
    totalPages: Math.max(1, Math.ceil(totalCount / PREVIEW_PAGE_SIZE)),
  };
}
