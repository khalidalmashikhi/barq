import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

// The view route resolves the provider identity with requireApprovedProvider();
// withApiV1Provider (real) maps its thrown auth errors to the envelope.
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const getSignedUrlMock = vi.fn();
vi.mock("@/lib/vehicles/documents/get-vehicle-document-signed-url", () => ({
  getVehicleDocumentSignedUrl: (...a: unknown[]) => getSignedUrlMock(...a),
  VEHICLE_DOC_SIGNED_URL_TTL_SECONDS: 60,
}));

const { GET } = await import("./route");

const PARAMS = { params: Promise.resolve({ id: "veh-1", docId: "doc-1" }) };
const req = () => new Request("http://x/api/v1/me/provider/vehicles/veh-1/documents/doc-1/view?locale=en");

beforeEach(() => {
  requireApprovedProviderMock.mockReset();
  getSignedUrlMock.mockReset();
});

describe("GET /api/v1/me/provider/vehicles/{id}/documents/{docId}/view", () => {
  it("200 returns a short-lived signed URL in JSON (no objectKey); passes vehicleId+docId+owner", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    getSignedUrlMock.mockResolvedValue({ signedUrl: "https://signed/x", filename: "reg.pdf" });
    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ url: "https://signed/x", filename: "reg.pdf", expiresInSeconds: 60 });
    expect(JSON.stringify(body)).not.toContain("objectKey");
    expect(getSignedUrlMock).toHaveBeenCalledWith("veh-1", "doc-1", { kind: "provider", providerId: "prov-1" });
  });

  it("404 (uniform) when the helper returns null (missing / mismatched vehicle-doc / not owned / storage off)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    getSignedUrlMock.mockResolvedValue(null);
    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("401 JSON when unauthenticated — no signed URL minted", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError());
    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("403 PROVIDER_NOT_APPROVED when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("nope", "PROVIDER_NOT_APPROVED"));
    const res = await GET(req(), PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PROVIDER_NOT_APPROVED");
  });
});
