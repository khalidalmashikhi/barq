import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
const providerUpdateMock = vi.fn();
const requirementFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
      // Present so a test can prove assertProviderApprovable NEVER writes (no
      // auto-demotion of an already-approved provider on a policy change).
      update: (...args: unknown[]) => providerUpdateMock(...args),
    },
    providerDocument: { findMany: (...args: unknown[]) => documentFindManyMock(...args) },
    providerVerificationRequirement: { findMany: (...args: unknown[]) => requirementFindManyMock(...args) },
  },
}));

const { assertProviderApprovable } = await import("./assert-provider-approvable");

afterEach(() => {
  providerFindUniqueMock.mockReset();
  documentFindManyMock.mockReset();
  providerUpdateMock.mockReset();
  requirementFindManyMock.mockReset();
});

// Default: an EMPTY policy table (unseeded) → the gate falls back to the code
// defaults, so the original suite's expectations hold unchanged. Individual tests
// override this to exercise a real configured policy or a DB read failure.
beforeEach(() => {
  requirementFindManyMock.mockResolvedValue([]);
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

describe("assertProviderApprovable — ADR-0017 configured policy", () => {
  it("uses a configured active policy to decide the required set (custom key blocks)", async () => {
    // Admin policy: companies must provide COMMERCIAL_REGISTRATION and VAT_CERTIFICATE.
    requirementFindManyMock.mockResolvedValue([
      { key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, active: true },
      { key: "VAT_CERTIFICATE", appliesTo: "COMPANY", required: true, active: true },
      { key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false, active: true },
    ]);
    providerFindUniqueMock.mockResolvedValue({ providerType: "COMPANY" });
    documentFindManyMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", status: "APPROVED" }]);

    // CR satisfied, VAT missing → one blocker for the configured custom key.
    expect(await assertProviderApprovable("p1")).toEqual([{ type: "VAT_CERTIFICATE", reason: "MISSING" }]);
  });

  it("does not block on an INACTIVE required requirement", async () => {
    requirementFindManyMock.mockResolvedValue([
      { key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, active: true },
      { key: "VAT_CERTIFICATE", appliesTo: "COMPANY", required: true, active: false }, // deactivated
    ]);
    providerFindUniqueMock.mockResolvedValue({ providerType: "COMPANY" });
    documentFindManyMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", status: "APPROVED" }]);

    expect(await assertProviderApprovable("p1")).toEqual([]);
  });

  it("FAILS CLOSED to the code defaults when the policy read throws (DB error)", async () => {
    requirementFindManyMock.mockRejectedValue(new Error("db down"));
    providerFindUniqueMock.mockResolvedValue({ providerType: "INDIVIDUAL" });
    documentFindManyMock.mockResolvedValue([]); // nothing uploaded

    // Must NOT resolve to zero requirements — the default IDENTITY_PROOF still blocks.
    expect(await assertProviderApprovable("p1")).toEqual([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);
  });

  it("never writes — an already-APPROVED provider is not auto-demoted when policy tightens", async () => {
    // Policy now requires an extra doc the provider lacks; the gate reports a
    // blocker but performs NO write (status changes only via explicit admin action).
    requirementFindManyMock.mockResolvedValue([
      { key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, active: true },
      { key: "VAT_CERTIFICATE", appliesTo: "COMPANY", required: true, active: true },
    ]);
    providerFindUniqueMock.mockResolvedValue({ providerType: "COMPANY" });
    documentFindManyMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", status: "APPROVED" }]);

    const blockers = await assertProviderApprovable("p1");
    expect(blockers).toEqual([{ type: "VAT_CERTIFICATE", reason: "MISSING" }]);
    expect(providerUpdateMock).not.toHaveBeenCalled(); // read-only: no demotion/suspension
  });
});
