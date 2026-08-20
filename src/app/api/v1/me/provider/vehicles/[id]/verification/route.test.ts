import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

// We exercise the REAL read model (get-asset-verification-data) here — mocking only
// requireApprovedProvider() (the auth boundary) and prisma. This mirrors the working
// VEHICLE-1B/view route tests: the auth error is thrown across the @/lib/auth mock so
// withApiV1Provider's instanceof mapping stays consistent. It also covers the read
// model + DTO end-to-end.
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => findFirstMock(...a) } } }));

const { GET } = await import("./route");

const VEHICLE = "550e8400-e29b-41d4-a716-446655440000";
const req = () => new Request(`http://x/api/v1/me/provider/vehicles/${VEHICLE}/verification?locale=en`);
const call = () => GET(req(), { params: Promise.resolve({ id: VEHICLE }) });

// A vehicle with the registration PENDING and insurance not-yet-uploaded.
const assetRow = {
  status: "REGISTERED",
  verificationStatus: "DRAFT",
  verificationSubmittedAt: null,
  verificationReason: null,
  documents: [{ id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "PENDING", rejectionReason: null, expiresAt: null }],
};

beforeEach(() => {
  requireApprovedProviderMock.mockReset();
  findFirstMock.mockReset();
});

describe("GET /api/v1/me/provider/vehicles/{id}/verification", () => {
  it("200 returns the objectKey-free two-axis checklist DTO, no-store", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    findFirstMock.mockResolvedValue(assetRow);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.vehicleId).toBe(VEHICLE);
    expect(body.operationalStatus).toBe("REGISTERED"); // separate axis
    expect(body.verificationStatus).toBe("DRAFT");
    expect(body.requirements).toHaveLength(2); // registration + insurance (code-owned registry)
    expect(body.submission).toEqual({ canSubmit: false, blockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }] });
    expect(JSON.stringify(body)).not.toContain("objectKey");
    expect(JSON.stringify(body)).not.toContain("labelKey");
    // The lookup is scoped to the caller's own provider + this vehicle (never enumerable).
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: VEHICLE, providerId: "prov-1", assetType: "VEHICLE" } }));
  });

  it("404 for a foreign/missing vehicle (reader returns null) — uniform, not enumerable", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    findFirstMock.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("401 JSON when unauthenticated", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError());
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("403 PROVIDER_NOT_APPROVED when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("nope", "PROVIDER_NOT_APPROVED"));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PROVIDER_NOT_APPROVED");
  });
});
