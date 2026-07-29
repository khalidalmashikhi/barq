import { describe, it, expect } from "vitest";
import { buildBreadcrumbListJsonLd, buildServiceProductJsonLd, buildProviderLocalBusinessJsonLd } from "./structured-data";

describe("buildBreadcrumbListJsonLd", () => {
  it("builds a positioned ListItem per breadcrumb, in order", () => {
    const result = buildBreadcrumbListJsonLd([
      { name: "Home", url: "https://example.com/en" },
      { name: "Experiences", url: "https://example.com/en/services" },
      { name: "Desert Tour", url: "https://example.com/en/services/1" },
    ]);

    expect(result["@type"]).toBe("BreadcrumbList");
    expect(result.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/en" },
      { "@type": "ListItem", position: 2, name: "Experiences", item: "https://example.com/en/services" },
      { "@type": "ListItem", position: 3, name: "Desert Tour", item: "https://example.com/en/services/1" },
    ]);
  });
});

describe("buildServiceProductJsonLd", () => {
  it("omits offers and aggregateRating entirely when no price/rating is supplied", () => {
    const result = buildServiceProductJsonLd({ name: "Desert Tour", url: "https://example.com/en/services/1" });

    expect(result).not.toHaveProperty("offers");
    expect(result).not.toHaveProperty("aggregateRating");
    expect(result).not.toHaveProperty("description");
  });

  it("includes offers only when both priceAmount and priceCurrency are supplied", () => {
    const result = buildServiceProductJsonLd({
      name: "Desert Tour",
      url: "https://example.com/en/services/1",
      priceAmount: "25.00",
      priceCurrency: "OMR",
    });

    expect(result.offers).toEqual({
      "@type": "Offer",
      price: "25.00",
      priceCurrency: "OMR",
      url: "https://example.com/en/services/1",
      availability: "https://schema.org/InStock",
    });
  });

  it("omits aggregateRating when ratingCount is zero, even if ratingValue is supplied", () => {
    const result = buildServiceProductJsonLd({
      name: "Desert Tour",
      url: "https://example.com/en/services/1",
      ratingValue: 0,
      ratingCount: 0,
    });

    expect(result).not.toHaveProperty("aggregateRating");
  });

  it("includes aggregateRating when a real rating and count exist", () => {
    const result = buildServiceProductJsonLd({
      name: "Desert Tour",
      url: "https://example.com/en/services/1",
      ratingValue: 4.5,
      ratingCount: 12,
    });

    expect(result.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
  });
});

describe("buildProviderLocalBusinessJsonLd", () => {
  it("omits image, address, and aggregateRating entirely when not supplied", () => {
    const result = buildProviderLocalBusinessJsonLd({ name: "Desert Co", url: "https://example.com/en/providers/1" });

    expect(result).not.toHaveProperty("image");
    expect(result).not.toHaveProperty("address");
    expect(result).not.toHaveProperty("aggregateRating");
  });

  it("includes a PostalAddress only from a real city string", () => {
    const result = buildProviderLocalBusinessJsonLd({
      name: "Desert Co",
      url: "https://example.com/en/providers/1",
      city: "Salalah",
    });

    expect(result.address).toEqual({ "@type": "PostalAddress", addressLocality: "Salalah" });
  });

  it("includes image only when logoUrl is supplied", () => {
    const result = buildProviderLocalBusinessJsonLd({
      name: "Desert Co",
      url: "https://example.com/en/providers/1",
      image: "https://cdn.example.com/logo.png",
    });

    expect(result.image).toBe("https://cdn.example.com/logo.png");
  });
});
