import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate + code→status mapping covered in the provider-mutation-* unit tests.
// These prove the WIRING for the service mutation routes: JSON body → the exact
// FormData the domain action expects, the URL id passed straight through
// (ownership stays in the domain — no client providerId), success re-reads via the
// ownership-scoped detail reader, and publish blockers ride along in details.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({ requireProvider: vi.fn().mockResolvedValue({ provider: { id: "p1" } }) }));

const createMock = vi.fn();
const updateMock = vi.fn();
const publishMock = vi.fn();
const unpublishMock = vi.fn();
const detailMock = vi.fn();
const listMock = vi.fn();
vi.mock("@/lib/provider/create-service", () => ({ createService: (...a: unknown[]) => createMock(...a) }));
vi.mock("@/lib/provider/update-service", () => ({ updateService: (...a: unknown[]) => updateMock(...a) }));
vi.mock("@/lib/provider/transition-service-status", () => ({
  publishService: (...a: unknown[]) => publishMock(...a),
  unpublishService: (...a: unknown[]) => unpublishMock(...a),
}));
vi.mock("@/lib/provider/queries/get-provider-service-detail", () => ({
  getProviderServiceDetail: (...a: unknown[]) => detailMock(...a),
}));
vi.mock("@/lib/provider/queries/get-provider-services", () => ({
  getProviderServices: (...a: unknown[]) => listMock(...a),
}));

const { POST: createPOST } = await import("./route");
const { PATCH: updatePATCH } = await import("./[id]/route");
const { POST: publishPOST } = await import("./[id]/publish/route");
const { POST: unpublishPOST } = await import("./[id]/unpublish/route");

const params = (id = "s1") => ({ params: Promise.resolve({ id }) });
const req = (path: string, body?: unknown, method = "POST") =>
  new Request(`http://x/api/v1/me/provider/services${path}?locale=en`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const DETAIL = {
  id: "s1",
  name: { ar: "سفاري", en: "Safari" },
  description: null,
  status: "DRAFT",
  priceAmount: "25.00",
  priceCurrency: "OMR",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  publishMock.mockReset();
  unpublishMock.mockReset();
  detailMock.mockReset();
});

describe("POST /api/v1/me/provider/services (create)", () => {
  it("201 → builds FormData from JSON, calls createService, re-reads, returns the detail DTO", async () => {
    createMock.mockResolvedValue({ ok: true, serviceId: "s1" });
    detailMock.mockResolvedValue(DETAIL);
    const res = await createPOST(req("", { nameAr: "سفاري", nameEn: "Safari", priceAmount: "25.00", categoryId: "c1" }));
    expect(res.status).toBe(201);
    // The domain action receives a FormData with the mapped fields (thin adapter).
    const fd = createMock.mock.calls[0]![0] as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("nameAr")).toBe("سفاري");
    expect(fd.get("nameEn")).toBe("Safari");
    expect(fd.get("priceAmount")).toBe("25.00");
    expect(fd.get("categoryId")).toBe("c1");
    expect(detailMock).toHaveBeenCalledWith("s1", "en");
    const body = await res.json();
    expect(body.id).toBe("s1");
    expect(body.price).toEqual({ amount: "25.00", currency: "OMR" });
  });

  it("accepts a numeric priceAmount by stringifying it into the FormData", async () => {
    createMock.mockResolvedValue({ ok: true, serviceId: "s1" });
    detailMock.mockResolvedValue(DETAIL);
    await createPOST(req("", { nameAr: "س", nameEn: "S", priceAmount: 25 }));
    expect((createMock.mock.calls[0]![0] as FormData).get("priceAmount")).toBe("25");
  });

  it("403 PROVIDER_NOT_APPROVED (an APPLIED provider) → never re-reads", async () => {
    createMock.mockResolvedValue({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    const res = await createPOST(req("", { nameAr: "س", nameEn: "S", priceAmount: "1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PROVIDER_NOT_APPROVED");
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT surfaces the domain validation result", async () => {
    createMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await createPOST(req("", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });
});

describe("PATCH /api/v1/me/provider/services/{id} (update)", () => {
  it("404 NOT_FOUND for a not-owned service (uniform), passing the URL id through", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    const res = await updatePATCH(req("/other", { nameAr: "س", nameEn: "S" }, "PATCH"), params("other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(updateMock.mock.calls[0]![0]).toBe("other");
    expect(updateMock.mock.calls[0]![1]).toBeInstanceOf(FormData);
  });

  it("200 on success re-reads and returns the detail DTO", async () => {
    updateMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue(DETAIL);
    const res = await updatePATCH(req("/s1", { nameAr: "سفاري", nameEn: "Safari" }, "PATCH"), params());
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("s1");
  });
});

describe("POST /api/v1/me/provider/services/{id}/publish", () => {
  it("422 SERVICE_NOT_PUBLISHABLE and surfaces ALL blockers in details", async () => {
    publishMock.mockResolvedValue({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE", "SERVICE_CATEGORY_REQUIRED"] });
    const res = await publishPOST(req("/s1/publish"), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("SERVICE_NOT_PUBLISHABLE");
    expect(body.error.details).toEqual({ blockers: ["NO_ACTIVE_PRICE", "SERVICE_CATEGORY_REQUIRED"] });
    expect(publishMock).toHaveBeenCalledWith("s1");
  });

  it("409 INVALID_STATUS_TRANSITION from the status graph", async () => {
    publishMock.mockResolvedValue({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    const res = await publishPOST(req("/s1/publish"), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("404 NOT_FOUND for a not-owned service", async () => {
    publishMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    const res = await publishPOST(req("/x/publish"), params("x"));
    expect(res.status).toBe(404);
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("200 on success re-reads and returns the detail DTO", async () => {
    publishMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "PUBLISHED" });
    const res = await publishPOST(req("/s1/publish"), params());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("PUBLISHED");
  });
});

describe("POST /api/v1/me/provider/services/{id}/unpublish", () => {
  it("200 on success (PUBLISHED → PAUSED)", async () => {
    unpublishMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "PAUSED" });
    const res = await unpublishPOST(req("/s1/unpublish"), params());
    expect(res.status).toBe(200);
    expect(unpublishMock).toHaveBeenCalledWith("s1");
    expect((await res.json()).status).toBe("PAUSED");
  });

  it("409 INVALID_STATUS_TRANSITION when not currently published", async () => {
    unpublishMock.mockResolvedValue({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    const res = await unpublishPOST(req("/s1/unpublish"), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});
