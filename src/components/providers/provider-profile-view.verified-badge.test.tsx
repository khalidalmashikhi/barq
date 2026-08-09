import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

// Provider Verification & Documents (Gate 3) — Verified badge regression.
//
// DEFECT FIXED: the two ungated preview routes (provider self-preview, admin
// preview) rendered "Verified Provider" for ANY provider, including APPLIED /
// UNDER_REVIEW / REJECTED ones — a false trust signal. The badge is now gated on
// status === "APPROVED", independent of mode. The public storefront (mode:
// "public") is only ever reached for APPROVED providers, so its behaviour is
// unchanged. These tests assert the gate holds across statuses and modes.
//
// Unlike the sibling share-suppression test, Badge is mocked as a PASS-THROUGH
// here so the "verifiedProviderLabel" text actually appears in the rendered tree.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));

vi.mock("@/components/ui/share-button", () => ({ ShareButton: () => null }));
vi.mock("@/components/dashboard/experience-card", () => ({ ExperienceCard: () => null }));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/pagination", () => ({ Pagination: () => null }));
vi.mock("@/components/ui/fade-in", () => ({ FadeIn: () => null }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => children }));

const { ProviderProfileView } = await import("./provider-profile-view");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function containsText(node: any, needle: string): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.includes(needle);
  if (typeof node === "number") return false;
  if (Array.isArray(node)) return node.some((c) => containsText(c, needle));
  if (typeof node === "object") return containsText(node.props?.children, needle);
  return false;
}

function baseProvider(status: string) {
  return {
    id: "prov-1",
    name: "Acme",
    description: "Great tours",
    status,
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
}

function render(status: string, mode: string): Promise<ReactElement> {
  return ProviderProfileView({
    provider: baseProvider(status),
    services: { items: [], page: 1, totalPages: 1 },
    basePath: "/en/providers/prov-1",
    providerUrl: "https://x/providers/prov-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mode: mode as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as Promise<ReactElement>;
}

describe("ProviderProfileView verified badge", () => {
  it("public (APPROVED): shows the Verified badge", async () => {
    const tree = await render("APPROVED", "public");
    expect(containsText(tree, "verifiedProviderLabel")).toBe(true);
  });

  it("admin-preview (APPROVED): shows the Verified badge", async () => {
    const tree = await render("APPROVED", "admin-preview");
    expect(containsText(tree, "verifiedProviderLabel")).toBe(true);
  });

  for (const status of ["APPLIED", "UNDER_REVIEW", "REJECTED"]) {
    it(`provider-preview (${status}): does NOT show the Verified badge`, async () => {
      const tree = await render(status, "provider-preview");
      expect(containsText(tree, "verifiedProviderLabel")).toBe(false);
    });

    it(`admin-preview (${status}): does NOT show the Verified badge`, async () => {
      const tree = await render(status, "admin-preview");
      expect(containsText(tree, "verifiedProviderLabel")).toBe(false);
    });
  }
});
