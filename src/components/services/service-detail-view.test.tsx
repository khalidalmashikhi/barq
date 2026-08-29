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
function ShareButtonMock() {
  return null;
}
vi.mock("@/components/ui/share-button", () => ({ ShareButton: ShareButtonMock }));
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findShareButton(tree: any): boolean {
  let found = false;
  collect(tree, (n) => {
    if (n.type === ShareButtonMock) found = true;
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

describe("ServiceDetailView ShareButton by mode", () => {
  it("public: ShareButton is rendered (the URL is publicly openable)", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public" })) as ReactElement;
    expect(findShareButton(tree)).toBe(true);
  });

  it("provider-preview: ShareButton is NOT rendered (would share a dead link)", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "provider-preview" })) as ReactElement;
    expect(findShareButton(tree)).toBe(false);
  });

  it("admin-preview: ShareButton is NOT rendered", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "admin-preview" })) as ReactElement;
    expect(findShareButton(tree)).toBe(false);
  });
});

// SERVICE INFORMATION MODEL — the detail view renders each booking-decision section
// ONLY when the service actually carries that data; a legacy service with nothing
// authored shows none of them (no repeated "Not specified" placeholder).
describe("ServiceDetailView service-information sections", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collectStrings(tree: any): string[] {
    const out: string[] = [];
    collect(tree, (n) => {
      const c = n.props?.children;
      if (typeof c === "string") out.push(c);
      if (Array.isArray(c)) for (const x of c) if (typeof x === "string") out.push(x);
    });
    return out;
  }

  const populatedInfo = {
    durationMinutes: 90,
    startInstructions: "Meet at the marina gate",
    inclusions: ["Bottled water", "Local guide"],
    exclusions: ["Gratuities"],
    customerRequirements: ["Bring a valid ID"],
    minBookingSeats: 2,
    maxBookingSeats: 6,
  };

  it("renders the authored inclusions, start instructions and section titles when present", async () => {
    const service = { ...baseService, info: populatedInfo };
    const tree = (await ServiceDetailView({ ...commonProps, service, mode: "public" })) as ReactElement;
    const text = collectStrings(tree).join(" | ");

    expect(text).toContain("Meet at the marina gate");
    expect(text).toContain("Bottled water");
    expect(text).toContain("Gratuities");
    expect(text).toContain("Bring a valid ID");
    // Section titles resolve to their i18n keys under the identity translator mock.
    expect(text).toContain("inclusionsTitle");
    expect(text).toContain("startInstructionsTitle");
  });

  it("renders NONE of the section titles for a legacy service with no data (graceful absence)", async () => {
    // baseService.info is the fully-empty shape.
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public" })) as ReactElement;
    const text = collectStrings(tree).join(" | ");

    for (const key of ["startInstructionsTitle", "inclusionsTitle", "exclusionsTitle", "requirementsTitle", "bookingSizeLabel"]) {
      expect(text).not.toContain(key);
    }
  });
});

// DISCOVERY & DETAIL TRUTHFULNESS — the public CTA must reflect real bookability and
// never send a customer into a booking dead-end.
describe("ServiceDetailView booking CTA by bookability (public)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collectStrings(tree: any): string[] {
    const out: string[] = [];
    collect(tree, (n) => {
      const c = n.props?.children;
      if (typeof c === "string") out.push(c);
      if (Array.isArray(c)) for (const x of c) if (typeof x === "string") out.push(x);
    });
    return out;
  }

  it("BOOKABLE_NOW → active Book link, no disabled CTA", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public", bookability: "BOOKABLE_NOW" })) as ReactElement;
    expect(findBookLink(tree)).toBe(true);
    expect(findDisabledCta(tree)).toBe(false);
  });

  it("SLOTLESS_BOOKABLE → active Book link (a request-style booking is still bookable)", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public", bookability: "SLOTLESS_BOOKABLE" })) as ReactElement;
    expect(findBookLink(tree)).toBe(true);
  });

  it("NO_CURRENT_AVAILABILITY → NO Book link; honest disabled state with the no-dates reason", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public", bookability: "NO_CURRENT_AVAILABILITY" })) as ReactElement;
    expect(findBookLink(tree)).toBe(false);
    expect(findDisabledCta(tree)).toBe(true);
    const text = collectStrings(tree).join(" | ");
    expect(text).toContain("noDatesCtaLabel");
    expect(text).not.toContain("bookNowButton"); // the active label is gone
  });

  it("UNAVAILABLE → NO Book link; disabled with the unavailable reason", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public", bookability: "UNAVAILABLE" })) as ReactElement;
    expect(findBookLink(tree)).toBe(false);
    expect(findDisabledCta(tree)).toBe(true);
    expect(collectStrings(tree).join(" | ")).toContain("unavailableCtaLabel");
  });

  it("omitted bookability keeps the prior always-active behaviour (backward-compatible)", async () => {
    const tree = (await ServiceDetailView({ ...commonProps, mode: "public" })) as ReactElement;
    expect(findBookLink(tree)).toBe(true);
  });
});
