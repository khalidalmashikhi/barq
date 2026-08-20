import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const uploadMock = vi.fn();
const getDataMock = vi.fn();
vi.mock("@/lib/vehicles/documents/upload-vehicle-document", () => ({ uploadVehicleDocument: (...a: unknown[]) => uploadMock(...a) }));
vi.mock("@/lib/vehicles/documents/get-asset-verification-data", () => ({ getVehicleVerificationData: (...a: unknown[]) => getDataMock(...a) }));

const { POST } = await import("./route");

const URL = "http://x/api/v1/me/provider/vehicles/veh-1/documents?locale=en";
const PARAMS = { params: Promise.resolve({ vehicleId: "veh-1" }) };
const data = { operationalStatus: "REGISTERED", verificationStatus: "DRAFT", verificationSubmittedAt: null, editable: true, submittable: false, submissionBlockers: [], verificationReason: null, items: [] };

function multipartReq(parts: { type?: string; file?: boolean }) {
  const fd = new FormData();
  if (parts.type !== undefined) fd.append("type", parts.type);
  if (parts.file) fd.append("file", new File(["abc"], "reg.pdf", { type: "application/pdf" }));
  return new Request(URL, { method: "POST", body: fd });
}

beforeEach(() => {
  requireProviderMock.mockReset().mockResolvedValue({});
  uploadMock.mockReset();
  getDataMock.mockReset().mockResolvedValue(data);
});

describe("POST /api/v1/me/provider/vehicles/{id}/documents (upload)", () => {
  it("201 uploads and returns the updated checklist; forwards vehicleId + type + file to the domain", async () => {
    uploadMock.mockResolvedValue({ ok: true, documentId: "doc-1" });
    const res = await POST(multipartReq({ type: "VEHICLE_REGISTRATION", file: true }), PARAMS);
    expect(res.status).toBe(201);
    expect(uploadMock).toHaveBeenCalledWith("veh-1", expect.objectContaining({ type: "VEHICLE_REGISTRATION", originalFilename: "reg.pdf", declaredMimeType: "application/pdf" }));
    expect((await res.json()).verificationStatus).toBe("DRAFT");
  });

  it("400 (NOT 500) on a bodyless POST", async () => {
    const res = await POST(new Request(URL, { method: "POST" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("400 on a non-multipart JSON body (wrong Content-Type)", async () => {
    const res = await POST(new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), PARAMS);
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("400 with reason MISSING_TYPE when type is absent", async () => {
    const res = await POST(multipartReq({ file: true }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.reason).toBe("MISSING_TYPE");
  });

  it("400 with reason EMPTY_FILE when file is absent", async () => {
    const res = await POST(multipartReq({ type: "VEHICLE_REGISTRATION" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.reason).toBe("EMPTY_FILE");
  });

  it("400 when the domain rejects an off-registry document type", async () => {
    uploadMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await POST(multipartReq({ type: "PASSPORT", file: true }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("404 (uniform) when the domain reports a foreign/missing vehicle", async () => {
    uploadMock.mockResolvedValue({ ok: false, error: "VEHICLE_NOT_FOUND" });
    const res = await POST(multipartReq({ type: "VEHICLE_REGISTRATION", file: true }), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("409 DOCUMENT_ALREADY_EXISTS when the type is already uploaded", async () => {
    uploadMock.mockResolvedValue({ ok: false, error: "ALREADY_EXISTS" });
    const res = await POST(multipartReq({ type: "VEHICLE_REGISTRATION", file: true }), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DOCUMENT_ALREADY_EXISTS");
  });

  it("401 JSON when unauthenticated — never parses the body, never calls the domain", async () => {
    requireProviderMock.mockReset().mockRejectedValue(new UnauthenticatedError());
    const res = await POST(multipartReq({ type: "VEHICLE_REGISTRATION", file: true }), PARAMS);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
