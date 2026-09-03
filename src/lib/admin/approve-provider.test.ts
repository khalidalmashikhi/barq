import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// approveProvider(), extended this phase to wrap its status update and
// its new audit-log write in one transaction. Mocks requireAdmin and
// prisma the same way other action-level tests in this codebase mock
// @/lib/auth/@/lib/db (see apply-as-provider.test.ts).

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();
// Customer → Provider Journey (C) — the post-approval notification write goes
// through prisma.notification.create (via notifyProviderApplicationEvent, which
// imports this same mocked prisma). Shared here so both the mutation and the
// notify helper resolve against one mock.
const notificationCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    notification: {
      create: (...args: unknown[]) => notificationCreateMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

// Provider Verification & Documents (Gate 3) — the server-side completeness gate
// is a composed primitive with its own unit tests (assert-provider-approvable.test.ts).
// Here we mock it so these tests exercise approveProvider's WIRING of it: an empty
// blocker array means approvable (unchanged happy path); a non-empty array must
// short-circuit before any transition/audit/notify.
const assertApprovableMock = vi.fn();
vi.mock("@/lib/provider/documents/assert-provider-approvable", () => ({
  assertProviderApprovable: (...args: unknown[]) => assertApprovableMock(...args),
}));

const { approveProvider } = await import("./approve-provider");

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
  notificationCreateMock.mockReset();
  assertApprovableMock.mockReset();
});

describe("approveProvider", () => {
  it("returns PROVIDER_NOT_FOUND when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_PENDING for a provider not in APPLIED/UNDER_REVIEW", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPROVED" });

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("Gate 1A: a DRAFT provider is NOT admin-approvable (must submit first) — PROVIDER_NOT_PENDING", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "DRAFT" });

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the provider and records an audit event atomically, in the same transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPLIED", userId: "user-9" });
    assertApprovableMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({});

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "019f4e4e-8116-7052-b15e-b79b5ccb1af9" },
      data: expect.objectContaining({ status: "APPROVED", approvedByAdminId: "admin-1" }),
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "provider.approved",
        entityType: "Provider",
        entityId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9",
        previousValue: { status: "APPLIED" },
      }),
    });
  });

  it("creates a PROVIDER_APPROVED notification for the provider's user AFTER a successful approval", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPLIED", userId: "user-9" });
    assertApprovableMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({});

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: true });
    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const arg = notificationCreateMock.mock.calls[0]![0] as {
      data: { userId: string; channel: string; eventType: string; entityType: string; entityId: string; content: Record<string, unknown> };
    };
    // Gate B2 — targets the provider's User, IN_APP channel, stable eventType +
    // server-derived entityType/entityId, kind inline for the existing
    // presentation layer, and NOT tied to a booking.
    expect(arg.data.userId).toBe("user-9");
    expect(arg.data.channel).toBe("IN_APP");
    expect(arg.data.eventType).toBe("provider.approved");
    expect(arg.data.entityType).toBe("Provider");
    expect(arg.data.entityId).toBe("019f4e4e-8116-7052-b15e-b79b5ccb1af9");
    expect(arg.data.content.kind).toBe("PROVIDER_APPROVED");
    expect(arg.data.content).not.toHaveProperty("causingBookingId");
    expect("causingBookingId" in arg.data).toBe(false);
  });

  it("still succeeds (status + audit committed) even if the post-approval notification write throws", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "UNDER_REVIEW", userId: "user-9" });
    assertApprovableMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockRejectedValue(new Error("notification store down"));

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    // The approval must NOT be rolled back or reported as failed — the
    // notification is fire-and-forget after the committed transaction.
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "019f4e4e-8116-7052-b15e-b79b5ccb1af9" },
      data: expect.objectContaining({ status: "APPROVED" }),
    });
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
  });

  it("refuses approval with INCOMPLETE_DOCUMENTS (and the blockers) when required documents are not complete", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPLIED", userId: "user-9" });
    const blockers = [{ type: "IDENTITY_PROOF", reason: "MISSING" }];
    assertApprovableMock.mockResolvedValue(blockers);

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "INCOMPLETE_DOCUMENTS", blockers });
  });

  it("does NOT transition, audit, or notify when approval is blocked by incomplete documents", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "UNDER_REVIEW", userId: "user-9" });
    assertApprovableMock.mockResolvedValue([{ type: "COMMERCIAL_REGISTRATION", reason: "NOT_APPROVED" }]);

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result.ok).toBe(false);
    // The completeness gate short-circuits BEFORE the transaction and the
    // post-commit notification — none of these side effects may fire.
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN_ERROR when an unexpected exception occurs", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });

  // Admin Provider Review Fail-Closed Integrity gate — the readiness check is the
  // server's independent authority. If it CANNOT be evaluated (the read throws),
  // approval must FAIL CLOSED: no transition, no audit, no notify, and a safe generic
  // error (never a leaked Prisma/storage message, never an assumed-empty "approvable").
  it("FAILS CLOSED (UNKNOWN_ERROR, no side effects) when the readiness read throws at mutation time", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPLIED", userId: "user-9" });
    assertApprovableMock.mockRejectedValue(new Error("verification store down: secret-connection-string"));

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    // The generic code must not carry the internal error detail.
    expect(JSON.stringify(result)).not.toContain("secret-connection-string");
    // Fail closed: the provider is NOT approved and nothing is recorded/announced.
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});
