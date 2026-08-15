import { describe, it, expect, beforeEach, vi } from "vitest";

// GET is covered in profile/route.test.ts. This covers the Gate PC PATCH wiring:
// JSON body → the FormData updateProviderProfile expects, success re-reads the
// canonical profile and returns the same DTO as GET, no internal fields leak, and
// logoUrl is NOT sent (it stays owned by the dedicated media endpoint, Gap C).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({ requireProvider: vi.fn().mockResolvedValue({ provider: { id: "p1" } }) }));

const updateMock = vi.fn();
const getProfileMock = vi.fn();
vi.mock("@/lib/provider/update-provider-profile", () => ({ updateProviderProfile: (...a: unknown[]) => updateMock(...a) }));
vi.mock("@/lib/provider/queries/get-provider-profile-for-edit", () => ({
  getProviderProfileForEdit: (...a: unknown[]) => getProfileMock(...a),
}));

const { PATCH } = await import("./route");

const patch = (body: unknown) =>
  new Request("http://x/api/v1/me/provider/profile?locale=en", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  updateMock.mockReset();
  getProfileMock.mockReset();
});

describe("PATCH /api/v1/me/provider/profile", () => {
  it("200 → builds FormData (never logoUrl), re-reads, returns the profile DTO with no internal fields", async () => {
    updateMock.mockResolvedValue({ ok: true });
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
    const res = await PATCH(
      patch({
        businessNameAr: "شركة",
        businessNameEn: "Co",
        businessDescriptionEn: "desc",
        contactEmail: "biz@x.com",
        city: "Salalah",
        providerType: "COMPANY",
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const fd = updateMock.mock.calls[0]![0] as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("businessNameAr")).toBe("شركة");
    expect(fd.get("businessNameEn")).toBe("Co");
    expect(fd.get("city")).toBe("Salalah");
    // logoUrl is owned by the media endpoint — this route must never submit it, so
    // updateProviderProfile leaves the stored logo untouched (formData.has → false).
    expect(fd.has("logoUrl")).toBe(false);

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
    const s = JSON.stringify(body);
    expect(s).not.toContain("userId");
    expect(s).not.toContain("authUserId");
  });

  it("400 INVALID_INPUT surfaces the domain validation result and never re-reads", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await PATCH(patch({ businessNameAr: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
    expect(getProfileMock).not.toHaveBeenCalled();
  });
});
