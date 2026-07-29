// Structured data (JSON-LD) builders — Growth Foundations phase.
//
// TRUTHFUL BY CONSTRUCTION: every builder below only ever includes a
// field when the caller actually supplies it — there is no default,
// fallback, or invented value anywhere in this file. A missing
// rating/image/price is an OMITTED schema.org property, never a zero,
// empty string, or placeholder. Callers must not pass fabricated data.
//
// Framework-independent (no "server-only" import): pure object
// builders, safe to call from any Server Component.

export type BreadcrumbItem = { name: string; url: string };

export function buildBreadcrumbListJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export type ServiceProductJsonLdInput = {
  name: string;
  description?: string;
  url: string;
  /** Decimal string, e.g. "25.00" — omit entirely (not "0") when no ACTIVE price exists. */
  priceAmount?: string;
  priceCurrency?: string;
  /** 1-5. Omit entirely (not 0) when no PUBLISHED review has a rating yet. */
  ratingValue?: number;
  ratingCount?: number;
};

/// Modeled as schema.org Product (not TouristAttraction): a bookable
/// Experience genuinely has a price and an aggregateRating, both of
/// which Product supports natively via `offers`/`aggregateRating` — the
/// two properties this phase's approved data (Price, Rating) can
/// truthfully populate.
export function buildServiceProductJsonLd(input: ServiceProductJsonLdInput) {
  const hasPrice = input.priceAmount !== undefined && input.priceCurrency !== undefined;
  const hasRating = input.ratingValue !== undefined && input.ratingCount !== undefined && input.ratingCount > 0;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    ...(hasPrice
      ? {
          offers: {
            "@type": "Offer",
            price: input.priceAmount,
            priceCurrency: input.priceCurrency,
            url: input.url,
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.ratingValue,
            reviewCount: input.ratingCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

export type ProviderLocalBusinessJsonLdInput = {
  name: string;
  description?: string;
  url: string;
  image?: string;
  city?: string;
  ratingValue?: number;
  ratingCount?: number;
};

export function buildProviderLocalBusinessJsonLd(input: ProviderLocalBusinessJsonLdInput) {
  const hasRating = input.ratingValue !== undefined && input.ratingCount !== undefined && input.ratingCount > 0;

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    ...(input.image ? { image: input.image } : {}),
    ...(input.city ? { address: { "@type": "PostalAddress", addressLocality: input.city } } : {}),
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.ratingValue,
            reviewCount: input.ratingCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}
