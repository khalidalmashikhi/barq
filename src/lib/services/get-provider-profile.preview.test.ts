import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System (provider) — getProviderProfileForPreview(): reads a
// provider by id WITHOUT the APPROVED+visible gate (so a not-yet-public
// provider can be previewed), while getProviderProfile's public gate stays
// untouched (covered by get-provider-profile.test.ts). Auth is the caller's job.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const serviceCountMock = vi.fn().mockResolvedValue(0);
const ratingAggregateMock = vi.fn().mockResolvedValue({ _avg: { value: null }, _count: { value: 0 } });
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    service: { count: (...a: unknown[]) => serviceCountMock(...a) },
    rating: { aggregate: (...a: unknown[]) => ratingAggregateMock(...a) },
  },
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/provider/get-provider-categories", () => ({ getProviderCategoryChips: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/provider/media/get-provider-media", () => ({
  getProviderMedia: vi.fn().mockResolvedValue({ cover: { url: "https://x/cover.jpg" }, portfolio: [{ url: "https://x/p1.jpg" }] }),
}));

const { getProviderProfileForPreview } = await import("./get-provider-profile");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => findUniqueMock.mockReset());

describe("getProviderProfileForPreview", () => {
  it("reads by id with NO approved/visible gate", async () => {
    findUniqueMock.mockResolvedValue(null);
    await getProviderProfileForPreview(PROVIDER_ID);

    const arg = findUniqueMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ id: PROVIDER_ID });
    expect(arg.where.status).toBeUndefined();
    expect(arg.where.visible).toBeUndefined();
  });

  it("maps a not-yet-public provider (APPLIED, visible:false) to the presentation shape", async () => {
    findUniqueMock.mockResolvedValue({
      id: PROVIDER_ID,
      businessName: { en: "Desert Co", ar: "شركة" },
      businessDescription: { en: "Tours", ar: "" },
      status: "APPLIED",
      providerType: "INDIVIDUAL",
      city: "Muscat",
      logoUrl: "https://x/logo.png",
      visible: false,
    });

    const result = await getProviderProfileForPreview(PROVIDER_ID);

    expect(result).toMatchObject({
      id: PROVIDER_ID,
      name: "Desert Co",
      status: "APPLIED",
      providerType: "INDIVIDUAL",
      coverUrl: "https://x/cover.jpg",
      portfolio: ["https://x/p1.jpg"],
    });
  });

  it("returns null for a malformed id (no query) and for a nonexistent provider", async () => {
    expect(await getProviderProfileForPreview("not-a-uuid")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();

    findUniqueMock.mockResolvedValue(null);
    expect(await getProviderProfileForPreview(PROVIDER_ID)).toBeNull();
  });
});
