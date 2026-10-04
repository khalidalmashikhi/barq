import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Unit suite (mocked Prisma + storage) for the onboarding start: ordering, fail-closed branches,
// what is written, and what is never logged or audited. It is NOT a concurrency proof — the
// same-key race is proven against real PostgreSQL in start-vehicle-onboarding.dbproof.test.ts.

vi.mock("server-only", () => ({}));

const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {
  code?: string;
  constructor(m?: string, c?: string) {
    super(m);
    this.code = c;
  }
}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
const rentalPredicateMock = vi.fn(() => {
  throw new Error("vehicle onboarding must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));

const loggerError = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { error: (...a: unknown[]) => loggerError(...a), info: vi.fn(), warn: vi.fn() } }));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));

const storageConfigured = vi.fn(() => true);
const uploadMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => storageConfigured(),
  uploadPrivateObject: (...a: unknown[]) => uploadMock(...a),
}));
const registerIntent = vi.fn();
const releaseIntent = vi.fn();
const attemptCleanup = vi.fn();
vi.mock("@/lib/storage/cleanup/private-object-cleanup", () => ({
  registerUploadIntent: (...a: unknown[]) => registerIntent(...a),
  releaseUploadIntent: (...a: unknown[]) => releaseIntent(...a),
  attemptPrivateObjectCleanup: (...a: unknown[]) => attemptCleanup(...a),
}));
const prepareMock = vi.fn();
vi.mock("@/lib/vehicles/documents/prepare-document", () => ({ prepareDocumentForStorage: (a: unknown) => prepareMock(a) }));

const findFirst = vi.fn();
const txAssetCreate = vi.fn();
const txVehicleCreate = vi.fn();
const txDocCreate = vi.fn();
const tx = {
  asset: { create: (...a: unknown[]) => txAssetCreate(...a) },
  vehicle: { create: (...a: unknown[]) => txVehicleCreate(...a) },
  assetDocument: { create: (...a: unknown[]) => txDocCreate(...a) },
};
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => findFirst(...a) },
    $transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  },
}));

const { startVehicleOnboarding } = await import("./start-vehicle-onboarding");

const KEY = "3f0c9d0e-5c1b-4f6f-9d6c-7b1f2a3c4d5e";
const FILENAME = "my-private-registration-scan.png";
const NORMALIZED = new ArrayBuffer(4321);
const input = (over: Record<string, unknown> = {}) => ({ requestKey: KEY, originalFilename: FILENAME, declaredMimeType: "image/png", bytes: new ArrayBuffer(64), ...over });
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["providerId", "onboardingRequestKey"] } });

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "user-1" }, provider: { id: "prov-1", status: "APPROVED" } });
  findFirst.mockResolvedValue(null);
  prepareMock.mockResolvedValue({ ok: true, bytes: NORMALIZED, mimeType: "image/jpeg", ext: "jpg", normalized: true });
  storageConfigured.mockReturnValue(true);
  registerIntent.mockResolvedValue("intent-1");
  uploadMock.mockResolvedValue(undefined);
  releaseIntent.mockResolvedValue(true);
  attemptCleanup.mockResolvedValue("completed");
  txAssetCreate.mockResolvedValue({});
  txVehicleCreate.mockResolvedValue({});
  txDocCreate.mockResolvedValue({ id: "doc-1" });
  auditMock.mockResolvedValue(undefined);
});

describe("startVehicleOnboarding — request key", () => {
  it.each([undefined, null, "", "short", "has space in it", "a".repeat(201), 12345678, { k: 1 }, "bad/key/with/slash"])(
    "a missing or malformed key (%j) is refused before authentication or any work",
    async (bad) => {
      expect(await startVehicleOnboarding(input({ requestKey: bad }))).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(requireApprovedProviderMock).not.toHaveBeenCalled();
      expect(prepareMock).not.toHaveBeenCalled();
      expect(uploadMock).not.toHaveBeenCalled();
    },
  );

  it("the key is bound to the AUTHENTICATED provider: the lookup is scoped by the session's provider id", async () => {
    await startVehicleOnboarding(input());
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId: "prov-1", onboardingRequestKey: KEY, assetType: "VEHICLE" } }));
  });

  it("REPLAY: an existing setup for this key is returned as-is — the replayed file is never prepared, stored or written", async () => {
    findFirst.mockResolvedValue({ id: "veh-existing" });
    expect(await startVehicleOnboarding(input())).toEqual({ ok: true, vehicleId: "veh-existing", replayed: true });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(registerIntent).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(txAssetCreate).not.toHaveBeenCalled();
    expect(txDocCreate).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled(); // audited once, by the original request only
  });
});

describe("startVehicleOnboarding — authority", () => {
  it("not approved → PROVIDER_NOT_APPROVED; no profile → NO_PROVIDER_PROFILE; nothing stored", async () => {
    requireApprovedProviderMock.mockRejectedValueOnce(new ForbiddenError("x", "PROVIDER_NOT_APPROVED"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    requireApprovedProviderMock.mockRejectedValueOnce(new ForbiddenError("x", "NO_PROVIDER_PROFILE"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("unauthenticated propagates (the route maps it to sign-in)", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError());
    await expect(startVehicleOnboarding(input())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("the general vehicle authority only — the rental workspace predicate is never consulted", async () => {
    expect((await startVehicleOnboarding(input())).ok).toBe(true);
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });
});

describe("startVehicleOnboarding — happy path", () => {
  it("prepares, records the intent, uploads the NORMALIZED bytes, then creates shell + document + audit in one transaction", async () => {
    const result = await startVehicleOnboarding(input());
    expect(result).toMatchObject({ ok: true, replayed: false });
    if (!result.ok) return;
    expect(result.vehicleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // UUID v7

    expect(prepareMock).toHaveBeenCalledWith(expect.objectContaining({ declaredMimeType: "image/png", pdfPolicy: "REGISTRATION" }));

    const stored = uploadMock.mock.calls[0]![0] as { objectKey: string; body: ArrayBuffer; contentType: string };
    expect(stored.body).toBe(NORMALIZED); // never the bytes as received
    expect(stored.contentType).toBe("image/jpeg");
    expect(stored.objectKey).toMatch(new RegExp(`^asset-documents/${result.vehicleId}/vehicle_registration/[0-9a-f-]{36}\\.jpg$`));
    expect(stored.objectKey).not.toContain("private-registration"); // server-generated key, never the filename

    // intent → upload → transaction
    expect(registerIntent).toHaveBeenCalledWith(stored.objectKey);
    expect(registerIntent.mock.invocationCallOrder[0]!).toBeLessThan(uploadMock.mock.invocationCallOrder[0]!);
    expect(uploadMock.mock.invocationCallOrder[0]!).toBeLessThan(txAssetCreate.mock.invocationCallOrder[0]!);

    expect(txAssetCreate).toHaveBeenCalledWith({ data: { id: result.vehicleId, providerId: "prov-1", assetType: "VEHICLE", status: "REGISTERED", onboardingRequestKey: KEY } });
    expect(txVehicleCreate).toHaveBeenCalledWith({ data: { assetId: result.vehicleId } }); // all business fields NULL
    expect(releaseIntent).toHaveBeenCalledWith(tx, stored.objectKey);
    expect(txDocCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ assetId: result.vehicleId, type: "VEHICLE_REGISTRATION", objectKey: stored.objectKey, mimeType: "image/jpeg", sizeBytes: 4321, status: "PENDING" }) });
    expect(attemptCleanup).not.toHaveBeenCalled();
  });

  it("is audited exactly once, inside the transaction, with NO key / storage key / filename / content", async () => {
    const result = await startVehicleOnboarding(input());
    expect(auditMock).toHaveBeenCalledTimes(1);
    const [event, client] = auditMock.mock.calls[0]!;
    expect(client).toBe(tx);
    expect(event).toMatchObject({ actorType: "PROVIDER", actorId: "prov-1", action: "vehicle.onboarding_draft_created", entityType: "Vehicle", newValue: { status: "REGISTERED", verificationStatus: "DRAFT", documentType: "VEHICLE_REGISTRATION", documentNormalized: true } });
    const raw = JSON.stringify(event);
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain("asset-documents/");
    expect(raw).not.toContain(FILENAME);
    if (result.ok) expect((event as { entityId: string }).entityId).toBe(result.vehicleId);
  });
});

describe("startVehicleOnboarding — fail closed", () => {
  it.each(["TOO_LARGE", "HEIC_UNSUPPORTED", "IMAGE_TOO_LARGE", "IMAGE_CORRUPT", "PDF_ENCRYPTED", "PDF_CORRUPT", "PDF_TOO_MANY_PAGES", "SIGNATURE_MISMATCH", "UNSUPPORTED_TYPE", "EMPTY_FILE"])(
    "a refused document (%s) creates no intent, no object and no rows",
    async (code) => {
      prepareMock.mockResolvedValue({ ok: false, error: code });
      expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: code });
      expect(registerIntent).not.toHaveBeenCalled();
      expect(uploadMock).not.toHaveBeenCalled();
      expect(txAssetCreate).not.toHaveBeenCalled();
    },
  );

  it("storage not configured → STORAGE_NOT_CONFIGURED, nothing written", async () => {
    storageConfigured.mockReturnValue(false);
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(registerIntent).not.toHaveBeenCalled();
    expect(txAssetCreate).not.toHaveBeenCalled();
  });

  it("the intent cannot be recorded → nothing is uploaded", async () => {
    registerIntent.mockRejectedValue(new Error("db down"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(txAssetCreate).not.toHaveBeenCalled();
  });

  it("the storage write fails → the (possibly partial) object's intent is resolved; no rows", async () => {
    uploadMock.mockRejectedValue(new Error("storage down"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UPLOAD_FAILED" });
    expect(attemptCleanup).toHaveBeenCalledWith("intent-1");
    expect(txAssetCreate).not.toHaveBeenCalled();
  });

  it("the audit write fails → the whole transaction fails and the uploaded object is cleaned up", async () => {
    auditMock.mockRejectedValue(new Error("audit boom"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(attemptCleanup).toHaveBeenCalledTimes(1);
    expect(attemptCleanup).toHaveBeenCalledWith("intent-1");
  });

  it("a database failure after the upload → the still-recorded intent is attempted (and stays durable if that fails)", async () => {
    txDocCreate.mockRejectedValue(new Error("db down"));
    attemptCleanup.mockRejectedValue(new Error("also down"));
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UNKNOWN_ERROR" }); // never throws
    expect(attemptCleanup).toHaveBeenCalledWith("intent-1");
  });

  it("an intent the worker already took cannot be released → no document row is persisted", async () => {
    releaseIntent.mockResolvedValue(false);
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(txDocCreate).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("startVehicleOnboarding — losing the same-key race", () => {
  it("a unique violation is answered with the WINNER's setup (never a raw database error), and the loser's object is cleaned", async () => {
    txAssetCreate.mockRejectedValue(p2002());
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "veh-winner" }); // fast path miss, then the winner
    expect(await startVehicleOnboarding(input())).toEqual({ ok: true, vehicleId: "veh-winner", replayed: true });
    expect(attemptCleanup).toHaveBeenCalledTimes(1);
    expect(attemptCleanup).toHaveBeenCalledWith("intent-1"); // exactly the loser's own object
    expect(txVehicleCreate).not.toHaveBeenCalled();
    expect(txDocCreate).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled(); // the loser writes no audit
  });

  it("a unique violation with no visible winner fails closed with a safe code", async () => {
    txAssetCreate.mockRejectedValue(p2002());
    findFirst.mockResolvedValue(null);
    expect(await startVehicleOnboarding(input())).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});

describe("startVehicleOnboarding — nothing sensitive is logged", () => {
  // The injected errors carry the sensitive values IN THEIR MESSAGE (as a storage client or a
  // database client realistically might): only a fixed category may reach the log.
  const leaky = () => new Error(`failed for asset-documents/abc/vehicle_registration/x.jpg key=${KEY} file=${FILENAME} https://bucket.example/sign?token=t`);
  it.each([
    ["intent failure", () => registerIntent.mockRejectedValue(leaky())],
    ["storage failure", () => uploadMock.mockRejectedValue(leaky())],
    ["transaction failure", () => txDocCreate.mockRejectedValue(leaky())],
    ["lost race with no visible winner", () => txAssetCreate.mockRejectedValue(p2002())],
  ])("%s: the log line carries no request key, storage key, URL or filename", async (_label, arrange) => {
    arrange();
    await startVehicleOnboarding(input());
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [event, fields] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toMatch(/^vehicleOnboarding\./);
    expect(Object.keys(fields).sort()).toEqual(["error", "providerId"]);
    const raw = JSON.stringify(loggerError.mock.calls[0]);
    for (const needle of [KEY, "asset-documents/", FILENAME, "https://", "token="]) expect(raw).not.toContain(needle);
  });
});
