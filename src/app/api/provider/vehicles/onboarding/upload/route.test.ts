import { describe, it, expect, vi, beforeEach } from "vitest";

// The onboarding upload route is a THIN adapter over startVehicleOnboarding (which owns validation,
// normalization, idempotency, storage and cleanup — covered by its own unit + real-PostgreSQL suites).
// Here we prove the adapter: the size ceiling is enforced BEFORE the bytes are read, the request key
// is forwarded untouched, a replay resumes the same setup, analysis is non-fatal, and both response
// styles (JSON for the fetch form, 303 for the no-JS form) carry only safe values.

vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, fn: () => unknown) => fn() }));
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({ UnauthenticatedError }));
const start = vi.fn();
const analyze = vi.fn();
vi.mock("@/lib/vehicles/onboarding/start-vehicle-onboarding", () => ({ startVehicleOnboarding: (...a: unknown[]) => start(...a) }));
vi.mock("@/lib/vehicles/registration-review/run-registration-analysis", () => ({ runRegistrationAnalysis: (...a: unknown[]) => analyze(...a) }));

const { POST } = await import("./route");

const KEY = "0b0e6f2a-1c1d-4a55-9c7e-3f6f0c1d2e3f";

function req(form: FormData, json = false) {
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", {
    method: "POST",
    body: form,
    headers: json ? { accept: "application/json" } : undefined,
  });
}
function withFile(locale = "ar", bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]), key: string | null = KEY) {
  const f = new FormData();
  f.set("locale", locale);
  if (key) f.set("requestKey", key);
  f.set("file", new File([bytes], "reg.pdf", { type: "application/pdf" }));
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue({ ok: true, vehicleId: "veh-1", replayed: false });
  analyze.mockResolvedValue({ ok: true, status: "EXTRACTED" });
});

describe("POST /api/provider/vehicles/onboarding/upload — progressive form (303)", () => {
  it("empty/missing file → EMPTY_FILE, nothing started", async () => {
    const f = new FormData();
    f.set("locale", "ar");
    f.set("requestKey", KEY);
    const res = await POST(req(f));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new?uploadError=EMPTY_FILE");
    expect(start).not.toHaveBeenCalled();
  });

  it("a body above the absolute ceiling is refused BEFORE the bytes are read or any work starts", async () => {
    const res = await POST(req(withFile("en", new Uint8Array(4 * 1024 * 1024 + 1))));
    expect(res.headers.get("location")).toContain("/en/provider/vehicles/new?uploadError=TOO_LARGE");
    expect(start).not.toHaveBeenCalled();
  });

  it("happy path → forwards the request key + file, analyzes, redirects to the review step", async () => {
    const res = await POST(req(withFile("en")));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ requestKey: KEY, originalFilename: "reg.pdf", declaredMimeType: "application/pdf" }));
    expect(analyze).toHaveBeenCalledWith("veh-1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/en\/provider\/vehicles\/new\/veh-1$/);
  });

  it("a REPLAY resumes the same setup (marked resumed) instead of creating another", async () => {
    start.mockResolvedValue({ ok: true, vehicleId: "veh-1", replayed: true });
    const res = await POST(req(withFile("ar")));
    expect(res.headers.get("location")).toMatch(/\/ar\/provider\/vehicles\/new\/veh-1\?resumed=1$/);
  });

  it("a missing request key is passed through as-is — the server operation refuses it", async () => {
    start.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await POST(req(withFile("ar", new Uint8Array([1]), null)));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ requestKey: null }));
    expect(res.headers.get("location")).toContain("uploadError=INVALID_INPUT");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("a refused start → redirect with the safe code, never analyze", async () => {
    start.mockResolvedValue({ ok: false, error: "HEIC_UNSUPPORTED" });
    const res = await POST(req(withFile("ar")));
    expect(analyze).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new?uploadError=HEIC_UNSUPPORTED");
  });

  it("a CANCELLED request (tombstone) → redirect with the terminal code; nothing is analyzed", async () => {
    start.mockResolvedValue({ ok: false, error: "ONBOARDING_CANCELLED" });
    const res = await POST(req(withFile("ar")));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new?uploadError=ONBOARDING_CANCELLED");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("extraction failure is non-fatal — the upload still succeeds and advances to review", async () => {
    analyze.mockRejectedValue(new Error("parser boom"));
    const res = await POST(req(withFile("ar")));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/ar/provider/vehicles/new/veh-1");
  });

  it("an unknown locale falls back to ar; an unauthenticated caller is sent to sign-in", async () => {
    start.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(req(withFile("xx")));
    expect(res.headers.get("location")).toMatch(/\/ar\/login$/);
  });
});

describe("POST /api/provider/vehicles/onboarding/upload — JSON (fetch form)", () => {
  it("success → { ok, redirectTo, replayed } and NOTHING else (no request key, storage key or filename)", async () => {
    const res = await POST(req(withFile("en"), true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, redirectTo: "/provider/vehicles/new/veh-1", replayed: false });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain("reg.pdf");
    expect(raw).not.toContain("asset-documents");
  });

  it("replay → the same destination, marked resumed", async () => {
    start.mockResolvedValue({ ok: true, vehicleId: "veh-1", replayed: true });
    const body = await (await POST(req(withFile("en"), true))).json();
    expect(body).toEqual({ ok: true, redirectTo: "/provider/vehicles/new/veh-1?resumed=1", replayed: true });
  });

  it.each([
    ["EMPTY_FILE", 400], ["TOO_LARGE", 400], ["UNSUPPORTED_TYPE", 400], ["SIGNATURE_MISMATCH", 400], ["HEIC_UNSUPPORTED", 400],
    ["IMAGE_TOO_LARGE", 400], ["IMAGE_CORRUPT", 400], ["PDF_ENCRYPTED", 400], ["PDF_CORRUPT", 400], ["PDF_TOO_MANY_PAGES", 400], ["INVALID_INPUT", 400],
    ["PROVIDER_NOT_APPROVED", 403], ["NO_PROVIDER_PROFILE", 403],
    ["ONBOARDING_CANCELLED", 409], ["ONBOARDING_IN_PROGRESS", 409],
    ["STORAGE_NOT_CONFIGURED", 503], ["UPLOAD_FAILED", 503],
    ["UNKNOWN_ERROR", 500],
  ])("failure %s → { ok:false, error } with status %i (a safe code, never a raw database error)", async (code, status) => {
    start.mockResolvedValue({ ok: false, error: code });
    const res = await POST(req(withFile("ar"), true));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error: code });
  });

  it("oversized body → 400 TOO_LARGE without starting", async () => {
    const res = await POST(req(withFile("ar", new Uint8Array(4 * 1024 * 1024 + 1)), true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(start).not.toHaveBeenCalled();
  });

  it("unauthenticated → 401 UNAUTHENTICATED", async () => {
    start.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(req(withFile("ar"), true));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  });

  it("an unparseable multipart body → 400 INVALID_INPUT", async () => {
    const res = await POST(
      new Request("https://barq.test/api/provider/vehicles/onboarding/upload", {
        method: "POST",
        body: "not multipart",
        headers: { accept: "application/json", "content-type": "multipart/form-data; boundary=missing" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(start).not.toHaveBeenCalled();
  });
});
