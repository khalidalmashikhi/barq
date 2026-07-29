import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
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
  createdAt: Date;
};

export type RelatedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
};

type ServiceDetailRow = {
  id: string;
  name: unknown;
  description: unknown;
  providerId: string;
  provider: { businessName: unknown; businessDescription: unknown; status: string };
  prices: Array<{ amount: unknown; currency: string }>;
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
    },
  });

  if (!service) return null;

  const row = service as ServiceDetailRow;
  const locale = await getLocale();

  return {
    id: row.id,
    name: extractLocalizedText(row.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    description: extractLocalizedText(row.description, locale),
    providerId: row.providerId,
    providerName: extractLocalizedText(row.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    providerDescription: extractLocalizedText(row.provider.businessDescription, locale),
    providerStatus: row.provider.status,
    price: row.prices[0] ? `${row.prices[0].amount} ${row.prices[0].currency}` : null,
    createdAt: row.createdAt,
  };
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
    },
  });

  return (services as ServiceDetailRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
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
