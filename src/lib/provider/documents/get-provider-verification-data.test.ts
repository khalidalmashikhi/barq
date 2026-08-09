import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Verification & Documents (Gate 3) — the single provider-side read that
// backs both /provider/verification and the dashboard readiness card. Mocks
// requireProvider, prisma.providerDocument.findMany and the storage config probe;
// documentVersionToken is exercised for real (sha256 of objectKey), so rows carry
// a real objectKey and the returned token is opaque (never the objectKey).

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
}));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { providerDocument: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}));

const storageConfiguredMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: (...a: unknown[]) => storageConfiguredMock(...a),
}));

const { getProviderVerificationData } = await import("./get-provider-verification-data");

afterEach(() => {
  requireProviderMock.mockReset();
  findManyMock.mockReset();
  storageConfiguredMock.mockReset();
});

function doc(overrides: Record<string, unknown>) {
  return {
    id: "d1",
    type: "IDENTITY_PROOF",
    status: "APPROVED",
    originalFilename: "id.pdf",
    sizeBytes: 1234,
    rejectionReason: null,
    objectKey: "provider-documents/prov-1/identity_proof/v1.pdf",
    ...overrides,
  };
}

describe("getProviderVerificationData", () => {
  it("lists the required document first, then optional ones, for a COMPANY with no uploads", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "COMPANY", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredTotal).toBe(1);
    expect(data.requiredApproved).toBe(0);
    // Required (COMMERCIAL_REGISTRATION) leads, then the optional types.
    expect(data.items[0]).toMatchObject({ type: "COMMERCIAL_REGISTRATION", required: true, document: null });
    expect(data.items.filter((i) => i.required).map((i) => i.type)).toEqual(["COMMERCIAL_REGISTRATION"]);
    const optional = data.items.filter((i) => !i.required).map((i) => i.type);
    expect(optional).toContain("IDENTITY_PROOF");
    expect(optional).toContain("TOURISM_LICENCE");
  });

  it("counts an APPROVED required document and exposes an opaque versionToken (never the objectKey)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPROVED" } });
    findManyMock.mockResolvedValue([doc({ type: "IDENTITY_PROOF", status: "APPROVED" })]);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredTotal).toBe(1);
    expect(data.requiredApproved).toBe(1);
    const identity = data.items.find((i) => i.type === "IDENTITY_PROOF")!;
    expect(identity.required).toBe(true);
    expect(identity.document).toMatchObject({ id: "d1", status: "APPROVED", originalFilename: "id.pdf" });
    // The opaque token is present and is NOT the raw objectKey.
    expect(typeof identity.document!.versionToken).toBe("string");
    expect(identity.document!.versionToken).not.toContain("provider-documents");
    expect(identity.document!).not.toHaveProperty("objectKey");
  });

  it("does not count a PENDING required document toward requiredApproved", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "UNDER_REVIEW" } });
    findManyMock.mockResolvedValue([doc({ type: "IDENTITY_PROOF", status: "PENDING" })]);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredApproved).toBe(0);
  });

  it("reflects storage availability from isDocumentStorageConfigured", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    storageConfiguredMock.mockReturnValue(false);

    const data = await getProviderVerificationData();

    expect(data.storageAvailable).toBe(false);
  });
});
