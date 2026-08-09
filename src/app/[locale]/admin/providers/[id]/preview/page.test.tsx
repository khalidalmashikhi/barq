import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System (provider) — admin provider preview authorization.
// requireAdmin gates it; admin can preview ANY provider regardless of status/
// visibility; non-admin -> 404; anonymous -> login.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
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
  getPathname: () => "/en/admin/providers/prov-1/preview",
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
const AdminProviderPreviewPage = pageModule.default;

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

const props = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

afterEach(() => vi.clearAllMocks());

describe("AdminProviderPreviewPage — RBAC", () => {
  it("renders any provider (incl. APPLIED/visible:false) for an admin in admin-preview mode", async () => {
    requireAdminMock.mockResolvedValue({});
    getProviderProfileForPreviewMock.mockResolvedValue({ id: "prov-1", name: "Acme", status: "APPLIED" });

    const el = await AdminProviderPreviewPage(props("prov-1"));

    expect(el).toBeTruthy();
    expect(findMode(el)).toBe("admin-preview");
    expect(getProviderProfileForPreviewMock).toHaveBeenCalledWith("prov-1");
  });

  it("returns 404 for a non-admin (Forbidden)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    await expect(AdminProviderPreviewPage(props("prov-1"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getProviderProfileForPreviewMock).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated user to login", async () => {
    requireAdminMock.mockRejectedValue(new UnauthenticatedError());
    await AdminProviderPreviewPage(props("prov-1"));
    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: "/login" }));
  });

  it("returns 404 when the provider does not exist", async () => {
    requireAdminMock.mockResolvedValue({});
    getProviderProfileForPreviewMock.mockResolvedValue(null);
    await expect(AdminProviderPreviewPage(props("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is marked noindex", () => {
    expect((pageModule.metadata as { robots?: { index?: boolean } }).robots).toMatchObject({ index: false });
  });
});
