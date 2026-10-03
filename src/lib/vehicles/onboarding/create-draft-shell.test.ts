import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {
  code?: string;
  constructor(m: string, code?: string) {
    super(m);
    this.code = code;
  }
}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
const canViewRentalWorkspaceMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: (...a: unknown[]) => canViewRentalWorkspaceMock(...a),
}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const assetCreate = vi.fn();
const vehicleCreate = vi.fn();
const txClient = { asset: { create: (...a: unknown[]) => assetCreate(...a) }, vehicle: { create: (...a: unknown[]) => vehicleCreate(...a) } };
const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (cb: (tx: unknown) => unknown) => transaction(cb) } }));

const { createDraftVehicleShell } = await import("./create-draft-shell");

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u-1" }, provider: { id: "prov-1", status: "APPROVED" } });
  canViewRentalWorkspaceMock.mockResolvedValue(true);
  assetCreate.mockResolvedValue({ id: "asset-1" });
  vehicleCreate.mockResolvedValue({ assetId: "asset-1" });
});

describe("createDraftVehicleShell", () => {
  it("creates an all-NULL Vehicle on a REGISTERED asset + audit, returns the id", async () => {
    const res = await createDraftVehicleShell();
    expect(res).toEqual({ ok: true, vehicleId: "asset-1" });
    expect(assetCreate.mock.calls[0]?.[0]).toMatchObject({ data: { providerId: "prov-1", assetType: "VEHICLE", status: "REGISTERED" } });
    // The Vehicle row carries NO business fields — just the shared key.
    expect(vehicleCreate.mock.calls[0]?.[0]).toEqual({ data: { assetId: "asset-1" } });
    const audit = auditMock.mock.calls.at(-1)?.[0] as { action: string };
    expect(audit.action).toBe("vehicle.onboarding_draft_created");
  });

  it("non-rental provider → NOT_RENTAL_PROVIDER, no transaction", async () => {
    canViewRentalWorkspaceMock.mockResolvedValue(false);
    const res = await createDraftVehicleShell();
    expect(res).toEqual({ ok: false, code: "NOT_RENTAL_PROVIDER" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("non-approved provider (ForbiddenError) → NOT_RENTAL_PROVIDER", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no", "PROVIDER_NOT_APPROVED"));
    expect(await createDraftVehicleShell()).toEqual({ ok: false, code: "NOT_RENTAL_PROVIDER" });
  });

  it("unauthenticated propagates (route adapter maps it)", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError("no session"));
    await expect(createDraftVehicleShell()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
