import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Verification & Documents (Gate 3) — unit tests for the approval
// completeness gate. assertProviderApprovable() composes existing primitives:
//   provider.providerType -> requiredDocumentTypesFor()
//   getProviderDocumentSnapshots() (prisma.providerDocument.findMany)
//   resolveRequiredDocumentBlockers() (pure)
// so here we mock ONLY @/lib/db and assert the composed behaviour end-to-end:
// which documents block approval, and which never do (optional TOURISM_LICENCE).

vi.mock("server-only", () => ({}));

const providerFindUniqueMock = vi.fn();
const documentFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...args: unknown[]) => providerFindUniqueMock(...args) },
    providerDocument: { findMany: (...args: unknown[]) => documentFindManyMock(...args) },
  },
}));

const { assertProviderApprovable } = await import("./assert-provider-approvable");

afterEach(() => {
  providerFindUniqueMock.mockReset();
  documentFindManyMock.mockReset();
});

describe("assertProviderApprovable", () => {
  it("returns no blockers for an INDIVIDUAL whose IDENTITY_PROOF is APPROVED", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([{ type: "IDENTITY_PROOF", status: "APPROVED" }]);

    expect(await assertProviderApprovable("p1")).toEqual([]);
  });

  it("returns no blockers for a COMPANY whose COMMERCIAL_REGISTRATION is APPROVED", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "COMPANY" });
    documentFindManyMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", status: "APPROVED" }]);

    expect(await assertProviderApprovable("p1")).toEqual([]);
  });

  it("blocks with MISSING when the required document was never uploaded", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([]);

    expect(await assertProviderApprovable("p1")).toEqual([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);
  });

  it("blocks with NOT_APPROVED when the required document exists but is PENDING", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "COMPANY" });
    documentFindManyMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", status: "PENDING" }]);

    expect(await assertProviderApprovable("p1")).toEqual([{ type: "COMMERCIAL_REGISTRATION", reason: "NOT_APPROVED" }]);
  });

  it("blocks with NOT_APPROVED when the required document was REJECTED", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([{ type: "IDENTITY_PROOF", status: "REJECTED" }]);

    expect(await assertProviderApprovable("p1")).toEqual([{ type: "IDENTITY_PROOF", reason: "NOT_APPROVED" }]);
  });

  it("never blocks on the optional TOURISM_LICENCE, even when PENDING, once the required doc is APPROVED", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([
      { type: "IDENTITY_PROOF", status: "APPROVED" },
      { type: "TOURISM_LICENCE", status: "PENDING" },
    ]);

    expect(await assertProviderApprovable("p1")).toEqual([]);
  });

  it("does not require the OTHER type's document (an INDIVIDUAL is not blocked by a missing COMMERCIAL_REGISTRATION)", async () => {
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([{ type: "IDENTITY_PROOF", status: "APPROVED" }]);

    expect(await assertProviderApprovable("p1")).toEqual([]);
  });

  it("returns no blockers for a non-existent provider (approveProvider handles PROVIDER_NOT_FOUND separately)", async () => {
    providerFindUniqueMock.mockResolvedValue(null);

    expect(await assertProviderApprovable("missing")).toEqual([]);
    expect(documentFindManyMock).not.toHaveBeenCalled();
  });
});
