import { describe, it, expect, beforeEach, vi } from "vitest";

// The provider auth-gate mapping (401 / NO_PROVIDER_PROFILE / PROVIDER_NOT_APPROVED
// / FORBIDDEN) is covered authoritatively in src/lib/api/v1/provider-auth.test.ts.
// This route test covers the success DTO shape + no-leak.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getProfileMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-profile-for-edit", () => ({
  getProviderProfileForEdit: (...a: unknown[]) => getProfileMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getProfileMock.mockReset());

describe("GET /api/v1/me/provider/profile", () => {
  it("200 returns the self-profile DTO (contactEmail present in self-view; '' → null; no internal fields)", async () => {
    getProfileMock.mockResolvedValue({
      id: "p1",
      businessNameAr: "شركة",
      businessNameEn: "Co",
      businessDescriptionAr: "",
      businessDescriptionEn: "desc",
      contactEmail: "biz@x.com",
      city: "Salalah",
      logoUrl: "",
      providerType: "COMPANY",
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/profile?locale=en"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: "p1",
      businessName: { ar: "شركة", en: "Co" },
      businessDescription: { ar: "", en: "desc" },
      providerType: "COMPANY",
      city: "Salalah",
      contactEmail: "biz@x.com",
      logoUrl: null,
    });
    expect(JSON.stringify(body)).not.toContain("userId");
    expect(JSON.stringify(body)).not.toContain("authUserId");
  });
});
