import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { Locale } from "@/i18n/locales";
import type { ReviewItem } from "@/components/services/reviews-section";

// Service detail query — Engineering Sprint (Services Marketplace).
//
// "Related services" uses same-provider as the relation, since no
// category/tag field exists to relate by (same gap noted in
// get-services.ts) — a real, defensible relation using existing data,
// not a fabricated one.

export type ServiceDetail = {
  id: string;
  name: string;
  description: string;
  providerId: string;
  providerName: string;
  providerDescription: string;
  /// Phase F.2 (Provider Presentation) — surfaces the real
  /// ProviderStatus so the detail page can show an honest "Verified
  /// Provider" badge for APPROVED providers, reusing the existing
  /// approval-workflow status rather than inventing a separate
  /// "verified" flag.
  providerStatus: string;
  price: string | null;
  // Discovery/display metadata (Core Service Enrichment, Gate 3). Both are raw
  // governed CODES (or null for legacy/unset rows), never localized — a consumer
  // maps them to display labels via i18n. pricingUnit describes the basis of
  // `price` for presentation ONLY; it does not affect totals or booking behaviour,
  // and it is read from the SAME ACTIVE Price row as `price` (never mixed).
  regionCode: string | null;
  pricingUnit: string | null;
  // Service media (Media Foundation, Gap C) — cover + ordered gallery URLs,
  // fetched via a bounded relational include on this same query (no N+1).
  coverUrl: string | null;
  gallery: string[];
  createdAt: Date;
};

export type RelatedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
  coverUrl: string | null;
};

type ServiceDetailRow = {
  id: string;
  name: unknown;
  description: unknown;
  providerId: string;
  regionCode?: string | null;
  provider: { businessName: unknown; businessDescription: unknown; status: string };
  prices: Array<{ amount: unknown; currency: string; pricingUnit?: string | null }>;
  mediaAssets?: Array<{ url: string; kind?: string }>;
  createdAt: Date;
};

export type ActivePriceOption = {
  id: string;
  amount: string;
  currency: string;
};

export async function getActivePricesForService(serviceId: string): Promise<ActivePriceOption[]> {
  if (!isValidUuid(serviceId)) return [];

  const prices = await prisma.price.findMany({
    where: { serviceId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  type PriceRow = { id: string; amount: unknown; currency: string };
  return (prices as PriceRow[]).map((price) => ({
    id: price.id,
    amount: String(price.amount),
    currency: price.currency,
  }));
}

// Shared row -> ServiceDetail mapping, used by BOTH the gated public read and
// the ungated preview read so their presentation shape is guaranteed identical
// (Unified Preview System). Presentation only — it applies no visibility gate.
function mapServiceDetailRow(row: ServiceDetailRow, locale: Locale): ServiceDetail {
  const mediaAssets = row.mediaAssets ?? [];
  const coverUrl = mediaAssets.find((m) => m.kind === "COVER")?.url ?? null;
  const gallery = mediaAssets.filter((m) => m.kind === "GALLERY").map((m) => m.url);

  return {
    id: row.id,
    name: extractLocalizedText(row.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    description: extractLocalizedText(row.description, locale),
    providerId: row.providerId,
    providerName: extractLocalizedText(row.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    providerDescription: extractLocalizedText(row.provider.businessDescription, locale),
    providerStatus: row.provider.status,
    price: row.prices[0] ? `${row.prices[0].amount} ${row.prices[0].currency}` : null,
    // regionCode is a Service scalar; pricingUnit rides the SAME ACTIVE price row
    // as `price` above (prices[0]) so amount/currency/unit never come from
    // different rows. Both null-tolerant for legacy/unset data.
    regionCode: row.regionCode ?? null,
    pricingUnit: row.prices[0] ? (row.prices[0].pricingUnit ?? null) : null,
    coverUrl,
    gallery,
    createdAt: row.createdAt,
  };
}

export async function getServiceById(id: string): Promise<ServiceDetail | null> {
  if (!isValidUuid(id)) return null;

  const service = await prisma.service.findFirst({
    // Production Blocker fix — this query previously filtered only on
    // Service.status, never Provider.status/visible, unlike this
    // codebase's own listing query (get-services.ts's "NO
    // PROVIDER-VISIBILITY GATE, FOUND AND FIXED" precedent, which
    // already applies this exact filter). A provider archived
    // (DEACTIVATED) after publishing a service kept that service fully
    // bookable through this page/query indefinitely — this closes that
    // gap the same way the listing page already was, so a visitor with
    // an old bookmark/shared link can no longer reach a deactivated
    // provider's service detail or booking flow at all.
    where: { id, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
      // Cover + gallery in one bounded, ordered include (no N+1). Capped at
      // 1 cover + MAX_SERVICE_GALLERY_ITEMS gallery images at write time.
      mediaAssets: { orderBy: { createdAt: "asc" }, select: { url: true, kind: true } },
    },
  });

  if (!service) return null;
  return mapServiceDetailRow(service as ServiceDetailRow, await getLocale());
}

// Unified Preview System — preview-capable read. IDENTICAL shape/mapping to
// getServiceById, but WITHOUT the PUBLISHED/APPROVED-visible gate, so an
// authorized provider/admin can preview a DRAFT/PAUSED/unpublished service.
// This does NOT weaken getServiceById (its gate above is untouched) and no
// PUBLIC route calls this: authorization (provider ownership / admin RBAC) is
// enforced by the caller BEFORE this runs. Returns null only for a malformed
// id or a nonexistent service.
export async function getServiceForPreview(id: string): Promise<ServiceDetail | null> {
  if (!isValidUuid(id)) return null;

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
      mediaAssets: { orderBy: { createdAt: "asc" }, select: { url: true, kind: true } },
    },
  });

  if (!service) return null;
  return mapServiceDetailRow(service as ServiceDetailRow, await getLocale());
}

/// Phase F.2 (Provider Presentation) — a real, cheap count of this
/// provider's other PUBLISHED experiences, for the detail page's
/// provider card. Not part of getServiceById's own return shape since
/// it is conceptually about the provider, not this one service.
export async function getProviderPublishedServicesCount(providerId: string): Promise<number> {
  return prisma.service.count({ where: { providerId, status: "PUBLISHED" } });
}

export async function getRelatedServices(serviceId: string, providerId: string): Promise<RelatedService[]> {
  const locale = await getLocale();

  const services = await prisma.service.findMany({
    where: {
      status: "PUBLISHED",
      providerId,
      id: { not: serviceId },
    },
    take: 4,
    orderBy: { createdAt: "desc" },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
      mediaAssets: { where: { kind: "COVER" }, take: 1, select: { url: true } },
    },
  });

  return (services as ServiceDetailRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    coverUrl: service.mediaAssets?.[0]?.url ?? null,
  }));
}

// Phase 4.1 ("Complete the Booking Lifecycle") — wires the already-
// existing Review/Rating data (seeded since Phase E.1, never rendered
// anywhere until now) into the Experience Detail page. Reviews.ts, its
// own component, is untouched: this only maps real rows into its
// existing ReviewItem[] shape.
//
// No name field exists anywhere on User/Customer (phone-OTP-only
// identity, by explicit prior design) — customerLabel uses a generic,
// honest, translated label ("Verified Traveler") rather than
// fabricating a name.
type ReviewRow = {
  id: string;
  content: string;
  createdAt: Date;
  rating: { value: number } | null;
};

// Growth Foundations phase — a real aggregate rating for a single
// Service, for use in its Product JSON-LD (structured-data.ts). Mirrors
// get-provider-profile.ts's own Rating-through-Review aggregate exactly,
// scoped by booking.serviceId instead of review.providerId (Review has
// no direct serviceId column — same relation getReviewsForService()
// above already reaches through).
export type ServiceRatingAggregate = { averageRating: number | null; reviewCount: number };

export async function getServiceRatingAggregate(serviceId: string): Promise<ServiceRatingAggregate> {
  if (!isValidUuid(serviceId)) return { averageRating: null, reviewCount: 0 };

  const aggregate = await prisma.rating.aggregate({
    where: { review: { moderationState: "PUBLISHED", booking: { serviceId } } },
    _avg: { value: true },
    _count: { value: true },
  });

  return { averageRating: aggregate._avg.value, reviewCount: aggregate._count.value };
}

export async function getReviewsForService(serviceId: string): Promise<ReviewItem[]> {
  if (!isValidUuid(serviceId)) return [];

  const reviews = await prisma.review.findMany({
    where: { moderationState: "PUBLISHED", booking: { serviceId } },
    include: { rating: true },
    orderBy: { createdAt: "desc" },
  });

  const t = await getServerTranslator("services");
  const customerLabel = t("verifiedTravelerLabel");

  return (reviews as ReviewRow[]).map((review) => ({
    id: review.id,
    customerLabel,
    rating: review.rating?.value ?? 0,
    content: review.content,
    createdAt: review.createdAt,
  }));
}
