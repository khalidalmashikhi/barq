import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System — admin service preview authorization: requireAdmin
// gates it (a non-admin gets a uniform 404), unauthenticated -> login, and an
// admin can preview any service (including unpublished) in admin-preview mode.

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
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));

const getServiceForPreviewMock = vi.fn();
vi.mock("@/lib/services/get-service-detail", () => ({
  getServiceForPreview: (...a: unknown[]) => getServiceForPreviewMock(...a),
  getRelatedServices: vi.fn().mockResolvedValue([]),
  getProviderPublishedServicesCount: vi.fn().mockResolvedValue(0),
  getReviewsForService: vi.fn().mockResolvedValue([]),
  getServiceRatingAggregate: vi.fn().mockResolvedValue({ averageRating: null, reviewCount: 0 }),
}));
vi.mock("@/lib/booking/get-available-slots", () => ({ getAvailableSlots: vi.fn().mockResolvedValue([]) }));

const serviceDetailViewMock = vi.fn((_props?: unknown) => null);
vi.mock("@/components/services/service-detail-view", () => ({
  ServiceDetailView: (props: unknown) => serviceDetailViewMock(props),
}));
vi.mock("@/components/preview/preview-banner", () => ({ PreviewBanner: () => null }));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/seo/build-public-url", () => ({ buildPublicUrl: () => "https://x/svc" }));

const pageModule = await import("./page");
const AdminServicePreviewPage = pageModule.default;

const params = (id: string) => Promise.resolve({ id });

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

afterEach(() => vi.clearAllMocks());

describe("AdminServicePreviewPage — RBAC", () => {
  it("renders any service (incl. unpublished) for an admin in admin-preview mode", async () => {
    requireAdminMock.mockResolvedValue({});
    getServiceForPreviewMock.mockResolvedValue({ id: "svc-1", providerId: "prov-1", name: "Trek" });

    const el = await AdminServicePreviewPage({ params: params("svc-1") });

    expect(el).toBeTruthy();
    expect(findMode(el)).toBe("admin-preview");
  });

  it("returns 404 for a non-admin (Forbidden)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());

    await expect(AdminServicePreviewPage({ params: params("svc-1") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getServiceForPreviewMock).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated user to login", async () => {
    requireAdminMock.mockRejectedValue(new UnauthenticatedError());

    await AdminServicePreviewPage({ params: params("svc-1") });

    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: "/login" }));
  });

  it("returns 404 when the service does not exist", async () => {
    requireAdminMock.mockResolvedValue({});
    getServiceForPreviewMock.mockResolvedValue(null);

    await expect(AdminServicePreviewPage({ params: params("missing") })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is marked noindex", () => {
    expect((pageModule.metadata as { robots?: { index?: boolean } }).robots).toMatchObject({ index: false });
  });
});
