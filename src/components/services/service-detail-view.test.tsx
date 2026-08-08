import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

// Unified Preview System — ServiceDetailView booking suppression. The SAME
// component renders an active "Book now" link in public mode and a DISABLED
// placeholder (no booking path) in any preview mode.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

// Identifiable Link so we can detect an active booking navigation in the tree.
function LinkMock() {
  return null;
}
vi.mock("@/i18n/navigation", () => ({ Link: LinkMock }));

// Children are stubbed to null; the tree-walk still recurses their props, and
// the booking control lives directly in ServiceDetailView, not in a child.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collect(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, visit));
    return;
  }
  visit(node);
  const children = node.props?.children;
  if (children !== undefined) collect(children, visit);
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
  coverUrl: null,
  gallery: [],
  createdAt: new Date(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const commonProps: any = {
  service: baseService,
  relatedServices: [],
  slots: [],
  providerPublishedServicesCount: 0,
  reviews: [],
  ratingAggregate: { averageRating: null, reviewCount: 0 },
  serviceUrl: "https://x/svc-1",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBookLink(tree: any): boolean {
  let found = false;
  collect(tree, (n) => {
    if (n.type === LinkMock && typeof n.props?.href === "string" && n.props.href.endsWith("/book")) found = true;
  });
  return found;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findDisabledCta(tree: any): boolean {
  let found = false;
  collect(tree, (n) => {
    if (n.props?.["aria-disabled"] === "true") found = true;
  });
  return found;
}

describe("ServiceDetailView booking CTA by mode", () => {
  it("public: renders an active Book link to /services/:id/book", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public" })) as ReactElement;
    expect(findBookLink(tree)).toBe(true);
    expect(findDisabledCta(tree)).toBe(false);
  });

  it("provider-preview: NO active booking link, disabled placeholder instead", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "provider-preview" })) as ReactElement;
    expect(findBookLink(tree)).toBe(false);
    expect(findDisabledCta(tree)).toBe(true);
  });

  it("admin-preview: NO active booking link, disabled placeholder instead", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "admin-preview" })) as ReactElement;
    expect(findBookLink(tree)).toBe(false);
    expect(findDisabledCta(tree)).toBe(true);
  });
});
