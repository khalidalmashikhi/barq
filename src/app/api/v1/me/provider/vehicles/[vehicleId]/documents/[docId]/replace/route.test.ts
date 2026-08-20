import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const replaceMock = vi.fn();
const getDataMock = vi.fn();
vi.mock("@/lib/vehicles/documents/replace-vehicle-document", () => ({ replaceVehicleDocument: (...a: unknown[]) => replaceMock(...a) }));
vi.mock("@/lib/vehicles/documents/get-asset-verification-data", () => ({ getVehicleVerificationData: (...a: unknown[]) => getDataMock(...a) }));

const { POST } = await import("./route");

const URL = "http://x/api/v1/me/provider/vehicles/veh-1/documents/doc-1/replace?locale=en";
const PARAMS = { params: Promise.resolve({ vehicleId: "veh-1", docId: "doc-1" }) };
const data = { operationalStatus: "REGISTERED", verificationStatus: "DRAFT", verificationSubmittedAt: null, editable: true, submittable: false, submissionBlockers: [], verificationReason: null, items: [] };

function fileReq() {
  const fd = new FormData();
  fd.append("file", new File(["abc"], "new.pdf", { type: "application/pdf" }));
  return new Request(URL, { method: "POST", body: fd });
}

beforeEach(() => {
  requireProviderMock.mockReset().mockResolvedValue({});
  replaceMock.mockReset();
  getDataMock.mockReset().mockResolvedValue(data);
});

describe("POST /api/v1/me/provider/vehicles/{id}/documents/{docId}/replace", () => {
  it("200 replaces and returns the updated checklist; forwards vehicleId + docId + file", async () => {
    replaceMock.mockResolvedValue({ ok: true });
    const res = await POST(fileReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(replaceMock).toHaveBeenCalledWith("veh-1", "doc-1", expect.objectContaining({ originalFilename: "new.pdf", declaredMimeType: "application/pdf" }));
  });

  it("400 (NOT 500) on a bodyless POST", async () => {
    const res = await POST(new Request(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(400);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("400 with reason EMPTY_FILE when no file part is present", async () => {
    const res = await POST(new Request(URL, { method: "POST", body: new FormData() }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.reason).toBe("EMPTY_FILE");
  });

  it("409 DOCUMENT_LOCKED when replacing an APPROVED document", async () => {
    replaceMock.mockResolvedValue({ ok: false, error: "LOCKED" });
    const res = await POST(fileReq(), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DOCUMENT_LOCKED");
  });

  it("404 (uniform) for a mismatched/foreign document", async () => {
    replaceMock.mockResolvedValue({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    const res = await POST(fileReq(), PARAMS);
    expect(res.status).toBe(404);
  });

  it("401 JSON when unauthenticated — never parses body, never calls the domain", async () => {
    requireProviderMock.mockReset().mockRejectedValue(new UnauthenticatedError());
    const res = await POST(fileReq(), PARAMS);
    expect(res.status).toBe(401);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
