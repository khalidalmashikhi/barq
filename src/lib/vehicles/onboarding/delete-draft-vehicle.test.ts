import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
// The rental-workspace predicate must play NO part in vehicle registration: if any onboarding code
// ever consults it again, this mock throws and the suite fails.
const rentalPredicateMock = vi.fn(() => {
  throw new Error("vehicle registration must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const enqueueCleanupMock = vi.fn().mockResolvedValue("cleanup-task-1");
const attemptCleanupMock = vi.fn().mockResolvedValue("completed");
vi.mock("@/lib/storage/cleanup/private-object-cleanup", () => ({
  enqueuePrivateObjectCleanup: (...a: unknown[]) => enqueueCleanupMock(...a),
  attemptPrivateObjectCleanup: (...a: unknown[]) => attemptCleanupMock(...a),
}));

const assetFindFirst = vi.fn();
const confDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const extDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const docDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
const vehDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
const assetDelete = vi.fn().mockResolvedValue({ id: "asset-1" });
const DOC_KEY = "asset-documents/asset-1/vehicle_registration/x.pdf";
// In-tx raw statements: the row lock (SELECT … FOR UPDATE) and the document DELETE … RETURNING.
const txQueryRaw = vi.fn((strings: TemplateStringsArray) => Promise.resolve(strings.join("").includes("DELETE") ? [{ objectKey: DOC_KEY }] : [{ id: "locked" }]));
const txAssetFindFirst = vi.fn();
const requestUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const txClient = {
  vehicleOnboardingRequest: { updateMany: (...a: unknown[]) => requestUpdateMany(...a) },
  $queryRaw: (strings: TemplateStringsArray, ...v: unknown[]) => txQueryRaw(strings, ...(v as [])),
  vehicleRegistrationConfirmation: { deleteMany: (...a: unknown[]) => confDeleteMany(...a) },
  vehicleRegistrationExtraction: { deleteMany: (...a: unknown[]) => extDeleteMany(...a) },
  assetDocument: { deleteMany: (...a: unknown[]) => docDeleteMany(...a) },
  vehicle: { deleteMany: (...a: unknown[]) => vehDeleteMany(...a) },
  asset: { findFirst: (...a: unknown[]) => txAssetFindFirst(...a), delete: (...a: unknown[]) => assetDelete(...a) },
};
const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) }, $transaction: (cb: (tx: unknown) => unknown) => transaction(cb) } }));

const { deleteDraftVehicle } = await import("./delete-draft-vehicle");

const VEHICLE = "11111111-1111-1111-1111-111111111111";
const shell = (over: Record<string, unknown> = {}) => ({
  id: VEHICLE,
  status: "REGISTERED",
  verificationStatus: "DRAFT",
  documents: [{ objectKey: "asset-documents/asset-1/vehicle_registration/x.pdf" }],
  registrationConfirmations: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  confDeleteMany.mockResolvedValue({ count: 0 });
  extDeleteMany.mockResolvedValue({ count: 0 });
  docDeleteMany.mockResolvedValue({ count: 1 });
  vehDeleteMany.mockResolvedValue({ count: 1 });
  assetDelete.mockResolvedValue({ id: "asset-1" });
  enqueueCleanupMock.mockResolvedValue("cleanup-task-1");
  attemptCleanupMock.mockResolvedValue("completed");
  requestUpdateMany.mockResolvedValue({ count: 1 });
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u-1" }, provider: { id: "prov-1", status: "APPROVED" } });
  assetFindFirst.mockResolvedValue(shell());
  txAssetFindFirst.mockResolvedValue(shell()); // authoritative in-tx re-check: still a blank shell
});

describe("deleteDraftVehicle", () => {
  it("blank DRAFT shell → removes children then Vehicle then Asset + audit, then reclaims the object", async () => {
    const res = await deleteDraftVehicle(VEHICLE);
    expect(res).toEqual({ ok: true });
    expect(confDeleteMany).toHaveBeenCalledWith({ where: { assetId: VEHICLE } });
    expect(vehDeleteMany).toHaveBeenCalledWith({ where: { assetId: VEHICLE } });
    expect(assetDelete).toHaveBeenCalledWith({ where: { id: VEHICLE } });
    expect(auditMock.mock.calls.at(-1)?.[0]).toMatchObject({ action: "vehicle.onboarding_draft_deleted" });
    // Durable cleanup: the key comes from the rows the DELETE … RETURNING actually removed (server-
    // derived, authoritative), is enqueued in-tx, then attempted after commit.
    expect(enqueueCleanupMock.mock.calls[0]![1]).toMatchObject({ objectKey: DOC_KEY, purpose: "VEHICLE_REGISTRATION_ONBOARDING" });
    expect(attemptCleanupMock).toHaveBeenCalledWith("cleanup-task-1");
    // The asset row is locked FIRST, before any check or delete.
    expect(txQueryRaw.mock.calls[0]![0].join("")).toContain("FOR UPDATE");
  });

  it("IDEMPOTENCY TOMBSTONE: the request that created the shell is marked CANCELLED in the SAME transaction, BEFORE the asset is deleted — and is never deleted itself", async () => {
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: true });
    expect(requestUpdateMany).toHaveBeenCalledTimes(1);
    const arg = requestUpdateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ assetId: VEHICLE });
    expect(arg.data).toMatchObject({ status: "CANCELLED", leaseToken: null, leaseExpiresAt: null });
    expect(arg.data.cancelledAt).toBeInstanceOf(Date);
    expect((arg.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000); // retained, not released
    expect(requestUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(assetDelete.mock.invocationCallOrder[0]!);
    expect(Object.keys(txClient.vehicleOnboardingRequest)).toEqual(["updateMany"]); // no delete path exists
  });

  it("a refused cancellation leaves the request untouched", async () => {
    txAssetFindFirst.mockResolvedValue(shell({ registrationConfirmations: [{ id: "c" }] }));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "NOT_DELETABLE" });
    expect(requestUpdateMany).not.toHaveBeenCalled();
  });

  it("RACE — finalize committed first (in-tx re-check sees a SUBMITTED claim) → NOT_DELETABLE, nothing deleted or queued", async () => {
    txAssetFindFirst.mockResolvedValue(shell({ registrationConfirmations: [{ id: "c" }] }));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "NOT_DELETABLE" });
    expect(assetDelete).not.toHaveBeenCalled();
    expect(vehDeleteMany).not.toHaveBeenCalled();
    expect(enqueueCleanupMock).not.toHaveBeenCalled();
    expect(attemptCleanupMock).not.toHaveBeenCalled();
  });

  it("RACE — shell vanished before the lock (in-tx re-check null) → non-enumerating VEHICLE_NOT_FOUND", async () => {
    txAssetFindFirst.mockResolvedValue(null);
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(enqueueCleanupMock).not.toHaveBeenCalled();
  });

  it("DB failure inside the transaction → UNKNOWN_ERROR and NO immediate storage attempt", async () => {
    assetDelete.mockRejectedValue(new Error("db down"));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(attemptCleanupMock).not.toHaveBeenCalled(); // nothing committed → nothing may be deleted
  });

  it("works for any approved provider — the rental predicate is never consulted", async () => {
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: true });
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });

  it("non-approved provider (ForbiddenError) → PROVIDER_NOT_APPROVED, no lookup", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no"));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "PROVIDER_NOT_APPROVED" });
    expect(assetFindFirst).not.toHaveBeenCalled();
  });

  it("already finalized (a SUBMITTED claim exists) → NOT_DELETABLE, no transaction", async () => {
    assetFindFirst.mockResolvedValue(shell({ registrationConfirmations: [{ id: "c" }] }));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "NOT_DELETABLE" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("not a DRAFT verification (e.g. already submitted for admin review) → NOT_DELETABLE", async () => {
    assetFindFirst.mockResolvedValue(shell({ verificationStatus: "SUBMITTED" }));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "NOT_DELETABLE" });
  });

  it("not REGISTERED (e.g. ACTIVE) → NOT_DELETABLE", async () => {
    assetFindFirst.mockResolvedValue(shell({ status: "ACTIVE" }));
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "NOT_DELETABLE" });
  });

  it("foreign/missing vehicle → VEHICLE_NOT_FOUND", async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await deleteDraftVehicle(VEHICLE)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });

  it("invalid uuid → VEHICLE_NOT_FOUND, no auth call", async () => {
    expect(await deleteDraftVehicle("nope")).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });
});
