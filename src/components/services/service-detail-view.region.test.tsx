import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

// Core Service Enrichment, Gate 4 — ServiceDetailView governorate + price-with-
// unit presentation (the SAME component renders public detail, provider preview,
// and admin preview, so this covers all three). The mocked translator echoes the
// key, and interpolates the priceWithUnit template, so we can assert what renders
// without depending on real message content.
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string, vals?: Record<string, unknown>) =>
    vals && vals.price !== undefined ? `${vals.price} / ${vals.unit}` : key,
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
vi.mock("@/components/services/service-gallery", () => ({ ServiceGallery: () => null }));
vi.mock("@/components/services/provider-profile-card", () => ({ ProviderProfileCard: () => null }));
vi.mock("@/components/services/reviews-section", () => ({ ReviewsSection: () => null }));
vi.mock("@/components/services/meeting-point-map", () => ({ MeetingPointMap: () => null }));
vi.mock("@/components/dashboard/experience-card", () => ({ ExperienceCard: () => null }));
vi.mock("@/components/services/booking-trust-panel", () => ({ BookingTrustPanel: () => null }));
vi.mock("@/components/services/safety-info", () => ({ SafetyInfo: () => null }));
vi.mock("@/components/ui/share-button", () => ({ ShareButton: () => null }));
vi.mock("@/components/ui/fade-in", () => ({ FadeIn: () => null }));
vi.mock("@/components/ui/badge", () => ({ Badge: () => null }));

const { ServiceDetailView } = await import("./service-detail-view");

function collectText(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined) return acc;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, acc));
    return acc;
  }
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) collectText(el.props.children, acc);
  return acc;
}

const baseService = {
  id: "svc-1",
  name: "Desert Trek",
  description: "A trek",
  providerId: "prov-1",
  providerName: "Acme",
  providerDescription: "",
  providerStatus: "APPROVED",
  price: "25 OMR",
  regionCode: "DHOFAR",
  pricingUnit: "PER_PERSON",
  coverUrl: null,
  gallery: [],
  info: {
    durationMinutes: null,
    startInstructions: null,
    inclusions: [],
    exclusions: [],
    customerRequirements: [],
    minBookingSeats: null,
    maxBookingSeats: null,
  },
  createdAt: new Date(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(serviceOverrides: Record<string, unknown>): Promise<ReactElement> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    service: { ...baseService, ...serviceOverrides },
    relatedServices: [],
    slots: [],
    providerPublishedServicesCount: 0,
    reviews: [],
    ratingAggregate: { averageRating: null, reviewCount: 0 },
    serviceUrl: "https://x/svc-1",
    mode: "public",
  };
  return ServiceDetailView(props) as Promise<ReactElement>;
}

describe("ServiceDetailView — governorate + pricing unit (Gate 4)", () => {
  it("shows the localized governorate and the price with its localized unit", async () => {
    const text = collectText(await render({})).join(" ");
    expect(text).toContain("governorate.fieldLabel");
    expect(text).toContain("governorate.DHOFAR");
    // priceWithUnit interpolation: "25 OMR / pricingUnit.PER_PERSON".
    expect(text).toContain("25 OMR / pricingUnit.PER_PERSON");
  });

  it("omits the governorate entirely when regionCode is null (no fake value)", async () => {
    const text = collectText(await render({ regionCode: null })).join(" ");
    expect(text).not.toContain("governorate.fieldLabel");
    expect(text).not.toContain("governorate.");
  });

  it("preserves the plain price when pricingUnit is null (old presentation kept)", async () => {
    const text = collectText(await render({ pricingUnit: null })).join(" ");
    expect(text).toContain("25 OMR");
    expect(text).not.toContain(" / ");
  });

  it("never leaks an unknown regionCode or pricingUnit as raw text", async () => {
    const text = collectText(await render({ regionCode: "ATLANTIS", pricingUnit: "PER_NIGHT" })).join(" ");
    expect(text).not.toContain("ATLANTIS");
    expect(text).not.toContain("PER_NIGHT");
    // Falls back to the plain price, unit omitted.
    expect(text).toContain("25 OMR");
    expect(text).not.toContain(" / ");
  });

  it("keeps the price+unit paired from the same values (amount and unit together)", async () => {
    const text = collectText(await render({ price: "40 OMR", pricingUnit: "PER_DAY" })).join(" ");
    expect(text).toContain("40 OMR / pricingUnit.PER_DAY");
  });
});
