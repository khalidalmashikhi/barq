import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const deleteMock = vi.fn();
const getDataMock = vi.fn();
vi.mock("@/lib/vehicles/documents/delete-vehicle-document", () => ({ deleteVehicleDocument: (...a: unknown[]) => deleteMock(...a) }));
vi.mock("@/lib/vehicles/documents/get-asset-verification-data", () => ({ getVehicleVerificationData: (...a: unknown[]) => getDataMock(...a) }));

const { DELETE } = await import("./route");

const PARAMS = { params: Promise.resolve({ vehicleId: "veh-1", docId: "doc-1" }) };
const req = () => new Request("http://x/api/v1/me/provider/vehicles/veh-1/documents/doc-1?locale=en", { method: "DELETE" });
const data = { operationalStatus: "REGISTERED", verificationStatus: "DRAFT", verificationSubmittedAt: null, editable: true, submittable: false, submissionBlockers: [], verificationReason: null, items: [] };

beforeEach(() => {
  requireProviderMock.mockReset().mockResolvedValue({});
  deleteMock.mockReset();
  getDataMock.mockReset().mockResolvedValue(data);
});

describe("DELETE /api/v1/me/provider/vehicles/{id}/documents/{docId}", () => {
  it("200 deletes and returns the updated checklist; forwards BOTH vehicleId + docId (path-binding)", async () => {
    deleteMock.mockResolvedValue({ ok: true });
    const res = await DELETE(req(), PARAMS);
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith("veh-1", "doc-1");
  });

  it("409 DOCUMENT_LOCKED when the document is APPROVED / verification not editable", async () => {
    deleteMock.mockResolvedValue({ ok: false, error: "LOCKED" });
    const res = await DELETE(req(), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DOCUMENT_LOCKED");
  });

  it("404 (uniform) for a mismatched/foreign document (path-binding fails)", async () => {
    deleteMock.mockResolvedValue({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    const res = await DELETE(req(), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("401 JSON when unauthenticated", async () => {
    requireProviderMock.mockReset().mockRejectedValue(new UnauthenticatedError());
    const res = await DELETE(req(), PARAMS);
    expect(res.status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
