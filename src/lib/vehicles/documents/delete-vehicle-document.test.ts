import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && (v.startsWith("asset-") || v.startsWith("doc-")) }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) {
      super(m);
      this.code = c;
    }
  },
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));
const removePrivateObjectMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/storage/storage", () => ({ removePrivateObject: (...a: unknown[]) => removePrivateObjectMock(...a) }));

const docFindFirstMock = vi.fn();
const txDeleteManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    assetDocument: { findFirst: (...a: unknown[]) => docFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ assetDocument: { deleteMany: (...a: unknown[]) => txDeleteManyMock(...a) } }),
  },
}));

const { deleteVehicleDocument } = await import("./delete-vehicle-document");

const VEHICLE = "asset-1";
const ownedDoc = (over: Record<string, unknown> = {}) => ({ id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", objectKey: "asset-documents/asset-1/vehicle_registration/x.pdf", assetId: "asset-1", asset: { verificationStatus: "DRAFT" }, ...over });

afterEach(() => vi.clearAllMocks());

describe("deleteVehicleDocument", () => {
  it("deletes an owned PENDING doc, audits, and removes the object after commit", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc());
    txDeleteManyMock.mockResolvedValue({ count: 1 });
    const result = await deleteVehicleDocument(VEHICLE, "doc-1");
    expect(result).toEqual({ ok: true });
    // Ownership + path-binding: query scoped by BOTH assetId (vehicleId) and provider.
    expect(docFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc-1", assetId: "asset-1", asset: { providerId: "prov-1", assetType: "VEHICLE" } } }));
    expect(txDeleteManyMock).toHaveBeenCalledWith({ where: { id: "doc-1", objectKey: ownedDoc().objectKey } });
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.document_deleted", entityType: "Vehicle", entityId: "asset-1" });
    expect(removePrivateObjectMock).toHaveBeenCalledWith(ownedDoc().objectKey);
  });

  it("allows deleting a REJECTED doc", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc({ status: "REJECTED" }));
    txDeleteManyMock.mockResolvedValue({ count: 1 });
    expect(await deleteVehicleDocument(VEHICLE, "doc-1")).toEqual({ ok: true });
  });

  it("rejects an invalid document id before auth", async () => {
    expect(await deleteVehicleDocument(VEHICLE, "bad")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid vehicle id before auth", async () => {
    expect(await deleteVehicleDocument("bad", "doc-1")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("PATH-BINDING: a provider's own vehicle-B document via vehicle-A URL is uniform DOCUMENT_NOT_FOUND", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockImplementation((args: { where?: { assetId?: string } }) => Promise.resolve(args?.where?.assetId === "asset-1" ? ownedDoc() : null));
    const result = await deleteVehicleDocument("asset-2", "doc-1");
    expect(result).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(txDeleteManyMock).not.toHaveBeenCalled();
  });

  it("returns DOCUMENT_NOT_FOUND for a foreign/missing document", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(null);
    expect(await deleteVehicleDocument(VEHICLE, "doc-x")).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(txDeleteManyMock).not.toHaveBeenCalled();
  });

  it("returns LOCKED when verification is not editable", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc({ asset: { verificationStatus: "APPROVED" } }));
    expect(await deleteVehicleDocument(VEHICLE, "doc-1")).toEqual({ ok: false, error: "LOCKED" });
  });

  it("returns LOCKED when deleting an APPROVED document (deferred policy)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc({ status: "APPROVED" }));
    expect(await deleteVehicleDocument(VEHICLE, "doc-1")).toEqual({ ok: false, error: "LOCKED" });
    expect(txDeleteManyMock).not.toHaveBeenCalled();
  });

  it("is idempotent-safe when the row was already removed (deleteMany count 0, no audit)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc());
    txDeleteManyMock.mockResolvedValue({ count: 0 });
    expect(await deleteVehicleDocument(VEHICLE, "doc-1")).toEqual({ ok: true });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
