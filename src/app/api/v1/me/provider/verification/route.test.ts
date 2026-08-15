import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate mapping covered in src/lib/api/v1/provider-auth.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getVerifMock = vi.fn();
vi.mock("@/lib/provider/documents/get-provider-verification-data", () => ({
  getProviderVerificationData: (...a: unknown[]) => getVerifMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getVerifMock.mockReset());

describe("GET /api/v1/me/provider/verification", () => {
  it("200 localizes checklist and NEVER exposes versionToken/objectKey; canProgress derived", async () => {
    getVerifMock.mockResolvedValue({
      providerType: "INDIVIDUAL",
      providerStatus: "APPLIED",
      storageAvailable: true,
      requiredTotal: 1,
      requiredApproved: 0,
      items: [
        {
          type: "IDENTITY_PROOF",
          required: true,
          name: { ar: "إثبات الهوية", en: "Identity Proof" },
          description: { ar: "وصف", en: "desc" },
          document: {
            id: "d1",
            status: "PENDING",
            originalFilename: "id.pdf",
            sizeBytes: 1000,
            rejectionReason: null,
            versionToken: "SECRET_TOKEN",
          },
        },
      ],
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/verification?locale=en"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceAvailable).toBe(false);
    expect(body.canProgress).toBe(false);
    expect(body.items[0].name).toBe("Identity Proof");
    expect(body.items[0].document).toEqual({
      id: "d1",
      status: "PENDING",
      originalFilename: "id.pdf",
      sizeBytes: 1000,
      rejectionReason: null,
    });
    const s = JSON.stringify(body);
    expect(s).not.toContain("versionToken");
    expect(s).not.toContain("SECRET_TOKEN");
    expect(s).not.toContain("objectKey");
  });
});
