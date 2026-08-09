import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

// Unified Preview System (provider) — ProviderProfileView share suppression.
// The SAME component renders a ShareButton in public mode and hides it in any
// preview mode (sharing a not-yet-public storefront is inappropriate).

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));

function ShareButtonMock() {
  return null;
}
vi.mock("@/components/ui/share-button", () => ({ ShareButton: ShareButtonMock }));
vi.mock("@/components/dashboard/experience-card", () => ({ ExperienceCard: () => null }));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/pagination", () => ({ Pagination: () => null }));
vi.mock("@/components/ui/fade-in", () => ({ FadeIn: () => null }));
vi.mock("@/components/ui/badge", () => ({ Badge: () => null }));

const { ProviderProfileView } = await import("./provider-profile-view");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasShareButton(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasShareButton);
  if (node.type === ShareButtonMock) return true;
  return hasShareButton(node.props?.children);
}

const provider = {
  id: "prov-1",
  name: "Acme",
  description: "Great tours",
  status: "APPROVED",
  providerType: "COMPANY",
  city: "Muscat",
  logoUrl: null,
  coverUrl: null,
  portfolio: [],
  publishedServicesCount: 0,
  averageRating: null,
  reviewCount: 0,
  categories: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const common: any = {
  provider,
  services: { items: [], page: 1, totalPages: 1 },
  basePath: "/en/providers/prov-1",
  providerUrl: "https://x/providers/prov-1",
};

describe("ProviderProfileView share suppression", () => {
  it("public: renders the ShareButton", async () => {
    const tree = (await ProviderProfileView({ ...common, mode: "public" })) as ReactElement;
    expect(hasShareButton(tree)).toBe(true);
  });

  it("provider-preview: hides the ShareButton", async () => {
    const tree = (await ProviderProfileView({ ...common, mode: "provider-preview" })) as ReactElement;
    expect(hasShareButton(tree)).toBe(false);
  });

  it("admin-preview: hides the ShareButton", async () => {
    const tree = (await ProviderProfileView({ ...common, mode: "admin-preview" })) as ReactElement;
    expect(hasShareButton(tree)).toBe(false);
  });
});
