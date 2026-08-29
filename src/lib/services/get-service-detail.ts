import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { pricingUnitLabelKey } from "@/lib/pricing-units";
import { readServiceInfo, localizeServiceInfo, type ServiceInfoLocalized } from "./service-info";
import { resolveHeadlinePrice } from "./headline-price";
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
  // Discovery & Detail Truthfulness — `price` is the deterministic MINIMUM within the
  // service's primary currency (resolveHeadlinePrice), and `priceIsFrom` is true when
  // more than one ACTIVE price exists in that currency, so the summary can show "From X"
  // honestly (the full per-option list still comes from getActivePricesForService).
  priceIsFrom: boolean;
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
  // Service Information Model (Booking Decision Data) — localized, customer-safe. Every
  // concept is empty (null / []) when the provider hasn't authored it, so the UI renders
  // nothing for it (legacy services show no "Not specified" placeholders).
  info: ServiceInfoLocalized;
  createdAt: Date;
};

export type RelatedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
  priceIsFrom: boolean;
  coverUrl: string | null;
};

type ServiceDetailRow = {
  id: string;
  name: unknown;
  description: unknown;
  providerId: string;
  regionCode?: string | null;
  durationMinutes?: number | null;
  startInstructions?: unknown;
  inclusions?: unknown;
  exclusions?: unknown;
  customerRequirements?: unknown;
  minBookingSeats?: number | null;
  maxBookingSeats?: number | null;
  provider: { businessName: unknown; businessDescription: unknown; status: string };
  prices: Array<{ id: string; amount: unknown; currency: string; pricingUnit?: string | null; createdAt: Date }>;
  mediaAssets?: Array<{ url: string; kind?: string }>;
  createdAt: Date;
};

// Shared headline derivation — the deterministic minimum within the primary currency,
// formatted as the same "amount currency" string the cards/detail already display.
function headlineFrom(prices: ServiceDetailRow["prices"]): { price: string | null; priceIsFrom: boolean; pricingUnit: string | null } {
  const headline = resolveHeadlinePrice(
    prices.map((p) => ({ id: p.id, amount: p.amount as Prisma.Decimal, currency: p.currency, pricingUnit: p.pricingUnit ?? null, createdAt: p.createdAt }))
  );
  return {
    price: headline ? `${headline.amount} ${headline.currency}` : null,
    priceIsFrom: headline?.isFrom ?? false,
    pricingUnit: headline?.pricingUnit ?? null,
  };
}

export type ActivePriceOption = {
  id: string;
  amount: string;
  currency: string;
  /// BOOKING-PRICE-SEMANTICS — the stable governed CODE this amount is priced per
  /// (PER_PERSON, PER_DAY, …), or null for a legacy/flat price. Never localized.
  pricingUnit: string | null;
  /// The SAME unit, already localized by the Platform. Null when there is no unit, and
  /// ALSO null for a code the label registry does not yet know — a consumer then shows
  /// the amount alone rather than leaking a raw code as customer-facing text.
  pricingUnitLabel: string | null;
};

/**
 * Every ACTIVE price for a service, each carrying its own unit.
 *
 * WHY THE UNIT TRAVELS PER OPTION. A service may have more than one ACTIVE price, and
 * until this gate the unit was read from the row and then dropped — twice. A client
 * offered "25.00 OMR" and "40.00 OMR" could tell the amounts apart but not what either
 * was priced per, which is not a choice a customer can make. `ServiceDetail.pricingUnit`
 * cannot fix that: it is taken from the FIRST active price only, so using it to label a
 * list would correctly label one option and mislabel the rest.
 *
 * THE LABEL IS RESOLVED HERE, ON THE PLATFORM. The pricing-unit vocabulary is
 * deliberately extensible and has no DB CHECK — `src/lib/pricing-units` is its only
 * allow-list, and the common i18n namespace its only translation. Handing a client the
 * raw code would force every client to mirror both, and to drift the moment a new unit
 * is added. `localeOverride` mirrors getServiceById()'s own additive parameter: Web
 * passes nothing and behaves exactly as before; the /api/v1 adapter passes its resolved
 * locale.
 *
 * DISPLAY METADATA ONLY, unchanged by this gate: the unit never multiplies by seats,
 * never feeds a total, and never reaches the booking/payment/snapshot pipeline.
 */
export async function getActivePricesForService(
  serviceId: string,
  localeOverride?: Locale
): Promise<ActivePriceOption[]> {
  if (!isValidUuid(serviceId)) return [];

  const prices = await prisma.price.findMany({
    where: { serviceId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  type PriceRow = { id: string; amount: unknown; currency: string; pricingUnit?: string | null };
  const rows = prices as PriceRow[];

  // One translator for the whole list, not one per row.
  const t = localeOverride
    ? await getServerTranslator({ locale: localeOverride, namespace: "common" })
    : await getServerTranslator("common");

  return rows.map((price) => {
    const unit = price.pricingUnit ?? null;
    // Fail safe: an unknown/future code keeps its stable value on the wire but resolves
    // to NO label, so it can never be rendered at a customer.
    const labelKey = pricingUnitLabelKey(unit);

    return {
      id: price.id,
      amount: String(price.amount),
      currency: price.currency,
      pricingUnit: unit,
      pricingUnitLabel: labelKey ? t(labelKey) : null,
    };
  });
}

// Shared row -> ServiceDetail mapping, used by BOTH the gated public read and
// the ungated preview read so their presentation shape is guaranteed identical
// (Unified Preview System). Presentation only — it applies no visibility gate.
function mapServiceDetailRow(row: ServiceDetailRow, locale: Locale): ServiceDetail {
  const mediaAssets = row.mediaAssets ?? [];
  const coverUrl = mediaAssets.find((m) => m.kind === "COVER")?.url ?? null;
  const gallery = mediaAssets.filter((m) => m.kind === "GALLERY").map((m) => m.url);
  const headline = headlineFrom(row.prices);

  return {
    id: row.id,
    name: extractLocalizedText(row.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    description: extractLocalizedText(row.description, locale),
    providerId: row.providerId,
    providerName: extractLocalizedText(row.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    providerDescription: extractLocalizedText(row.provider.businessDescription, locale),
    providerStatus: row.provider.status,
    // Deterministic MINIMUM within the primary currency, with its own unit — never an
    // arbitrary unordered prices[0]. The per-option list (getActivePricesForService) is
    // where a customer sees every price; this is the single headline.
    price: headline.price,
    priceIsFrom: headline.priceIsFrom,
    // regionCode is a Service scalar; pricingUnit rides the SAME headline (min) price row.
    regionCode: row.regionCode ?? null,
    pricingUnit: headline.pricingUnit,
    coverUrl,
    gallery,
    info: localizeServiceInfo(
      readServiceInfo({
        durationMinutes: row.durationMinutes ?? null,
        startInstructions: row.startInstructions,
        inclusions: row.inclusions,
        exclusions: row.exclusions,
        customerRequirements: row.customerRequirements,
        minBookingSeats: row.minBookingSeats ?? null,
        maxBookingSeats: row.maxBookingSeats ?? null,
      }),
      locale
    ),
    createdAt: row.createdAt,
  };
}

// `localeOverride` (additive, optional): the `/api/v1` HTTP adapter passes an
// explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getServiceById(id: string, localeOverride?: Locale): Promise<ServiceDetail | null> {
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
      prices: {
        where: { status: "ACTIVE" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, currency: true, pricingUnit: true, createdAt: true },
      },
      // Cover + gallery in one bounded, ordered include (no N+1). Capped at
      // 1 cover + MAX_SERVICE_GALLERY_ITEMS gallery images at write time.
      mediaAssets: { orderBy: { createdAt: "asc" }, select: { url: true, kind: true } },
    },
  });

  if (!service) return null;
  return mapServiceDetailRow(service as ServiceDetailRow, localeOverride ?? (await getLocale()));
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
      prices: {
        where: { status: "ACTIVE" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, currency: true, pricingUnit: true, createdAt: true },
      },
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
      // Discovery & Detail Truthfulness — apply the SAME provider-visibility gate the
      // listing and detail readers use. Without it a related-services strip could surface
      // a sibling service whose provider was later suspended/hidden (same-provider scope
      // limited the blast radius, but the omission was a real truthfulness gap).
      provider: { status: "APPROVED", visible: true },
      providerId,
      id: { not: serviceId },
    },
    take: 4,
    orderBy: { createdAt: "desc" },
    include: {
      provider: true,
      prices: {
        where: { status: "ACTIVE" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, currency: true, pricingUnit: true, createdAt: true },
      },
      mediaAssets: { where: { kind: "COVER" }, take: 1, select: { url: true } },
    },
  });

  return (services as ServiceDetailRow[]).map((service) => {
    const headline = headlineFrom(service.prices);
    return {
      id: service.id,
      name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
      providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
      price: headline.price,
      priceIsFrom: headline.priceIsFrom,
      coverUrl: service.mediaAssets?.[0]?.url ?? null,
    };
  });
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
