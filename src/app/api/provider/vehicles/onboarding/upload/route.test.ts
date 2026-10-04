import { describe, it, expect, vi, beforeEach } from "vitest";

// Gate 5 — the onboarding upload route's orchestration + fail-safe cleanup. The file-signature /
// MIME / size / magic-byte validation itself lives in uploadVehicleDocument → validateDocumentUpload
// (covered by their own suites); here we prove the route: rejects an empty file BEFORE creating a
// shell, creates the shell then uploads then auto-analyzes, and RECLAIMS the shell when the upload
// fails so no blank DRAFT is stranded. Server-derived identity only (no client providerId).

vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, fn: () => unknown) => fn() }));
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({ UnauthenticatedError }));
const createShell = vi.fn();
const deleteDraft = vi.fn();
const uploadDoc = vi.fn();
const analyze = vi.fn();
vi.mock("@/lib/vehicles/onboarding/create-draft-shell", () => ({ createDraftVehicleShell: (...a: unknown[]) => createShell(...a) }));
vi.mock("@/lib/vehicles/onboarding/delete-draft-vehicle", () => ({ deleteDraftVehicle: (...a: unknown[]) => deleteDraft(...a) }));
vi.mock("@/lib/vehicles/documents/upload-vehicle-document", () => ({ uploadVehicleDocument: (...a: unknown[]) => uploadDoc(...a) }));
vi.mock("@/lib/vehicles/registration-review/run-registration-analysis", () => ({ runRegistrationAnalysis: (...a: unknown[]) => analyze(...a) }));

const { POST } = await import("./route");

function req(form: FormData) {
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form });
}
function withFile(locale = "ar", bytes = new Uint8Array([1, 2, 3])) {
  const f = new FormData();
  f.set("locale", locale);
  f.set("file", new File([bytes], "reg.pdf", { type: "application/pdf" }));
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  createShell.mockResolvedValue({ ok: true, vehicleId: "veh-1" });
  uploadDoc.mockResolvedValue({ ok: true, documentId: "doc-1" });
  analyze.mockResolvedValue({ ok: true, status: "EXTRACTED" });
  deleteDraft.mockResolvedValue({ ok: true });
});

describe("POST /api/provider/vehicles/onboarding/upload", () => {
  it("empty/missing file → EMPTY_FILE redirect, NO shell created", async () => {
    const f = new FormData();
    f.set("locale", "ar");
    const res = await POST(req(f));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new?uploadError=EMPTY_FILE");
    expect(createShell).not.toHaveBeenCalled();
  });

  it("happy path → create shell, upload registration, auto-analyze, redirect to step 2", async () => {
    const res = await POST(req(withFile("en")));
    expect(createShell).toHaveBeenCalledTimes(1);
    expect(uploadDoc).toHaveBeenCalledWith("veh-1", expect.objectContaining({ type: "VEHICLE_REGISTRATION", originalFilename: "reg.pdf", declaredMimeType: "application/pdf" }));
    expect(analyze).toHaveBeenCalledWith("veh-1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/en/provider/vehicles/new/veh-1");
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("upload failure → reclaim the just-created shell, redirect with the error, never analyze", async () => {
    uploadDoc.mockResolvedValue({ ok: false, error: "FILE_TOO_LARGE" });
    const res = await POST(req(withFile("ar")));
    expect(deleteDraft).toHaveBeenCalledWith("veh-1");
    expect(analyze).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new?uploadError=FILE_TOO_LARGE");
  });

  it("non-approved provider / shell refused → redirect with code, upload never attempted", async () => {
    createShell.mockResolvedValue({ ok: false, code: "PROVIDER_NOT_APPROVED" });
    const res = await POST(req(withFile("ar")));
    expect(uploadDoc).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("uploadError=PROVIDER_NOT_APPROVED");
  });

  it("extraction failure is non-fatal — the upload still succeeds and advances to review", async () => {
    analyze.mockRejectedValue(new Error("parser boom"));
    const res = await POST(req(withFile("ar")));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new/veh-1");
  });
});
