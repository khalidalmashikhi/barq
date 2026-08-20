import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

// The mutation gate pre-authenticates with the real requireProvider() — mock only it.
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const submitMock = vi.fn();
const getDataMock = vi.fn();
vi.mock("@/lib/vehicles/documents/submit-vehicle-verification", () => ({ submitVehicleVerification: (...a: unknown[]) => submitMock(...a) }));
vi.mock("@/lib/vehicles/documents/get-asset-verification-data", () => ({ getVehicleVerificationData: (...a: unknown[]) => getDataMock(...a) }));

const { POST } = await import("./route");

const submittedData = {
  operationalStatus: "REGISTERED",
  verificationStatus: "SUBMITTED",
  verificationSubmittedAt: new Date("2026-08-20T00:00:00.000Z"),
  editable: false,
  submittable: false,
  submissionBlockers: [],
  verificationReason: null,
  items: [],
};

const req = () => new Request("http://x/api/v1/me/provider/vehicles/veh-1/verification/submit?locale=en", { method: "POST" });
const call = () => POST(req(), { params: Promise.resolve({ vehicleId: "veh-1" }) });

beforeEach(() => {
  requireProviderMock.mockReset();
  submitMock.mockReset();
  getDataMock.mockReset();
});

describe("POST /api/v1/me/provider/vehicles/{id}/verification/submit", () => {
  it("200 returns the resulting SUBMITTED verification state", async () => {
    requireProviderMock.mockResolvedValue({});
    submitMock.mockResolvedValue({ ok: true, status: "SUBMITTED", alreadySubmitted: false });
    getDataMock.mockResolvedValue(submittedData);
    const res = await call();
    expect(res.status).toBe(200);
    expect(submitMock).toHaveBeenCalledWith("veh-1");
    expect((await res.json()).verificationStatus).toBe("SUBMITTED");
  });

  it("422 VERIFICATION_NOT_READY with blockers in details when required docs are incomplete", async () => {
    requireProviderMock.mockResolvedValue({});
    submitMock.mockResolvedValue({ ok: false, error: "NOT_READY", blockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }] });
    const res = await call();
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VERIFICATION_NOT_READY");
    expect(body.error.details.blockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "MISSING" }]);
    expect(getDataMock).not.toHaveBeenCalled();
  });

  it("409 INVALID_STATUS_TRANSITION from a non-submittable state", async () => {
    requireProviderMock.mockResolvedValue({});
    submitMock.mockResolvedValue({ ok: false, error: "INVALID_STATE" });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("404 for a foreign/missing vehicle", async () => {
    requireProviderMock.mockResolvedValue({});
    submitMock.mockResolvedValue({ ok: false, error: "VEHICLE_NOT_FOUND" });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("401 JSON when unauthenticated (mutation gate blocks before the action)", async () => {
    requireProviderMock.mockRejectedValue(new UnauthenticatedError());
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(submitMock).not.toHaveBeenCalled();
  });
});
