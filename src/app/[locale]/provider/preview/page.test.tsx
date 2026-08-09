import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System (provider) — provider self-preview authorization.
// The provider id comes from the authenticated context (requireProvider), never
// the URL, so a provider can only ever preview their own storefront. APPLIED/
// UNDER_REVIEW/APPROVED may preview (requireProvider); SUSPENDED/DEACTIVATED
// throw Forbidden -> 404; anonymous -> login.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  getPathname: () => "/en/provider/preview",
}));

const getProviderProfileForPreviewMock = vi.fn();
vi.mock("@/lib/services/get-provider-profile", () => ({
  getProviderProfileForPreview: (...a: unknown[]) => getProviderProfileForPreviewMock(...a),
}));
const getServicesPreviewMock = vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 });
vi.mock("@/lib/services/get-provider-services-for-preview", () => ({
  getProviderPublishedServicesForPreview: (...a: unknown[]) => getServicesPreviewMock(...a),
}));

vi.mock("@/components/providers/provider-profile-view", () => ({
  ProviderProfileView: () => null,
}));
vi.mock("@/components/preview/preview-banner", () => ({ PreviewBanner: () => null }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: vi.fn().mockResolvedValue((k: string) => k) }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/seo/build-public-url", () => ({ buildPublicUrl: () => "https://x/p" }));

const pageModule = await import("./page");
const ProviderProfilePreviewPage = pageModule.default;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMode(node: any): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const m = findMode(n);
      if (m) return m;
    }
    return undefined;
  }
  if (typeof node.props?.mode === "string") return node.props.mode;
  return findMode(node.props?.children);
}

const props = () => ({ searchParams: Promise.resolve({}) });

afterEach(() => vi.clearAllMocks());

describe("ProviderProfilePreviewPage — self-preview", () => {
  it("renders the authenticated provider's own storefront in provider-preview mode", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    getProviderProfileForPreviewMock.mockResolvedValue({ id: "prov-1", name: "Acme" });

    const el = await ProviderProfilePreviewPage(props());

    expect(el).toBeTruthy();
    expect(findMode(el)).toBe("provider-preview");
    // Uses the authenticated provider's own id — never a URL-supplied id.
    expect(getProviderProfileForPreviewMock).toHaveBeenCalledWith("prov-1");
    expect(getServicesPreviewMock).toHaveBeenCalledWith("prov-1", 1);
  });

  it("returns 404 when the provider is SUSPENDED/DEACTIVATED or not a provider (Forbidden)", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError());
    await expect(ProviderProfilePreviewPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getProviderProfileForPreviewMock).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated user to login", async () => {
    requireProviderMock.mockRejectedValue(new UnauthenticatedError());
    await ProviderProfilePreviewPage(props());
    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: "/login" }));
  });

  it("is marked noindex", () => {
    expect((pageModule.metadata as { robots?: { index?: boolean } }).robots).toMatchObject({ index: false });
  });
});
