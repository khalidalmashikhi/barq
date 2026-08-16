import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { requireProviderMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requireProviderMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const findUniqueMock = vi.fn();
const deleteManyMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerDocument: { deleteMany: (...a: unknown[]) => deleteManyMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const removeMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({ removePrivateObject: (...a: unknown[]) => removeMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { deleteProviderDocument } = await import("./delete-provider-document");
const { documentVersionToken } = await import("./document-version-token");

const KEY = "provider-documents/prov-1/identity_proof/x.jpg";
const token = documentVersionToken(KEY);
const doc = (status: string) => ({ id: "doc-1", providerId: "prov-1", objectKey: KEY, type: "IDENTITY_PROOF", status });

beforeEach(() => {
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT" } });
  removeMock.mockResolvedValue(undefined);
  deleteManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("deleteProviderDocument", () => {
  it("deletes a PENDING document (conditional delete + audit + object removal)", async () => {
    findUniqueMock.mockResolvedValue(doc("PENDING"));
    const result = await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token });
    expect(result).toEqual({ ok: true });
    const del = deleteManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(del.where).toEqual({ id: "doc-1", objectKey: KEY, status: { in: ["PENDING", "REJECTED"] } });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.document_deleted", actorType: "PROVIDER" } });
    expect(removeMock).toHaveBeenCalledWith(KEY);
  });

  it("deletes a REJECTED document", async () => {
    findUniqueMock.mockResolvedValue(doc("REJECTED"));
    expect(await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token })).toEqual({ ok: true });
  });

  it("refuses to delete an APPROVED document (replace-only)", async () => {
    findUniqueMock.mockResolvedValue(doc("APPROVED"));
    const result = await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token });
    expect(result).toEqual({ ok: false, error: "NOT_DELETABLE" });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("returns STALE_DOCUMENT when the version token no longer matches", async () => {
    findUniqueMock.mockResolvedValue(doc("PENDING"));
    expect(await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: "stale" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("returns STALE_DOCUMENT when the conditional delete matches 0 rows (concurrent replace)", async () => {
    findUniqueMock.mockResolvedValue(doc("PENDING"));
    deleteManyMock.mockResolvedValue({ count: 0 });
    expect(await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("returns DOCUMENT_NOT_FOUND for another provider's document", async () => {
    findUniqueMock.mockResolvedValue({ ...doc("PENDING"), providerId: "prov-2" });
    expect(await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token })).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
  });

  it.each(["UNDER_REVIEW", "APPLIED", "APPROVED", "REJECTED"])(
    "Gate 1A server invariant: a %s provider cannot delete (APPLICATION_LOCKED) — before the document is even looked up",
    async (status) => {
      requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status } });
      expect(await deleteProviderDocument({ documentId: "doc-1", expectedVersionToken: token })).toEqual({
        ok: false,
        error: "APPLICATION_LOCKED",
      });
      expect(findUniqueMock).not.toHaveBeenCalled();
    }
  );
});
