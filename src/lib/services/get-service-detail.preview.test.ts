import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System — getServiceForPreview(): reads a service by id
// WITHOUT the PUBLISHED/APPROVED-visible gate (so DRAFT/unpublished can be
// previewed), while getServiceById's public gate stays untouched (covered by
// get-service-detail.test.ts). Authorization is enforced by the caller, not here.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { service: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

const { getServiceForPreview } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => findUniqueMock.mockReset());

describe("getServiceForPreview", () => {
  it("reads by id with NO published/visibility gate", async () => {
    findUniqueMock.mockResolvedValue(null);
    await getServiceForPreview(SERVICE_ID);

    const arg = findUniqueMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ id: SERVICE_ID });
    // Explicitly NOT gated (unlike getServiceById).
    expect(arg.where.status).toBeUndefined();
    expect(arg.where.provider).toBeUndefined();
  });

  it("maps an unpublished (DRAFT) service to the same ServiceDetail shape", async () => {
    findUniqueMock.mockResolvedValue({
      id: SERVICE_ID,
      name: { en: "Desert Trek", ar: "رحلة" },
      description: { en: "A trek", ar: "" },
      providerId: "prov-1",
      provider: { businessName: { en: "Acme", ar: "" }, businessDescription: { en: "", ar: "" }, status: "APPLIED" },
      prices: [{ amount: 25, currency: "OMR" }],
      mediaAssets: [
        { url: "https://x/cover.jpg", kind: "COVER" },
        { url: "https://x/g1.jpg", kind: "GALLERY" },
      ],
      createdAt: new Date(),
    });

    const result = await getServiceForPreview(SERVICE_ID);

    expect(result).toMatchObject({
      id: SERVICE_ID,
      name: "Desert Trek",
      providerId: "prov-1",
      providerStatus: "APPLIED",
      price: "25 OMR",
      coverUrl: "https://x/cover.jpg",
      gallery: ["https://x/g1.jpg"],
    });
  });

  it("returns null for a malformed id (no query) and for a nonexistent service", async () => {
    expect(await getServiceForPreview("not-a-uuid")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();

    findUniqueMock.mockResolvedValue(null);
    expect(await getServiceForPreview(SERVICE_ID)).toBeNull();
  });
});
