import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Review / Reject / Resubmit — rejectProvider() domain tests. Mocks
// requireAdmin + prisma the same way approve-provider.test.ts does, plus the
// notification.create the post-commit notify hook goes through (via the same
// mocked prisma). Proves: pending-only transition, mandatory reason, the
// optimistic conditional guard (updateMany count), atomic audit-with-reason,
// post-commit PROVIDER_REJECTED notification, and notification-failure
// isolation.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
const notificationCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    notification: { create: (...a: unknown[]) => notificationCreateMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        provider: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { rejectProvider } = await import("./reject-provider");

const PID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateManyMock.mockReset();
  auditCreateMock.mockReset();
  notificationCreateMock.mockReset();
});

function adminOk() {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
}

describe("rejectProvider", () => {
  it("APPLIED → REJECTED: trims + stores the reason, records audit with reason, notifies post-commit", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ userId: "user-9", status: "APPLIED" });
    updateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({});

    const result = await rejectProvider(PID, "  Please add a valid business name  ");

    expect(result).toEqual({ ok: true });

    // Conditional guard scoped to rejectable statuses; rejection fields set.
    const updateArg = updateManyMock.mock.calls[0]![0] as {
      where: { id: string; status: { in: string[] } };
      data: { status: string; rejectionReason: string; rejectedByAdminId: string; rejectedAt: Date };
    };
    expect(updateArg.where).toEqual({ id: PID, status: { in: ["APPLIED", "UNDER_REVIEW"] } });
    expect(updateArg.data.status).toBe("REJECTED");
    expect(updateArg.data.rejectionReason).toBe("Please add a valid business name");
    expect(updateArg.data.rejectedByAdminId).toBe("admin-1");
    expect(updateArg.data.rejectedAt).toBeInstanceOf(Date);

    // Audit retains the reason permanently (survives resubmission clearing).
    const auditArg = auditCreateMock.mock.calls[0]![0] as {
      data: { action: string; previousValue: unknown; newValue: { reason: string } };
    };
    expect(auditArg.data.action).toBe("provider.rejected");
    expect(auditArg.data.previousValue).toEqual({ status: "APPLIED" });
    expect(auditArg.data.newValue.reason).toBe("Please add a valid business name");

    // Post-commit notification (Gate B2 — IN_APP + structured metadata).
    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const notifArg = notificationCreateMock.mock.calls[0]![0] as {
      data: { userId: string; channel: string; eventType: string; entityType: string; entityId: string; content: { kind: string } };
    };
    expect(notifArg.data.userId).toBe("user-9");
    expect(notifArg.data.channel).toBe("IN_APP");
    expect(notifArg.data.eventType).toBe("provider.rejected");
    expect(notifArg.data.entityType).toBe("Provider");
    expect(notifArg.data.entityId).toBe(PID);
    expect(notifArg.data.content.kind).toBe("PROVIDER_REJECTED");
  });

  it("UNDER_REVIEW → REJECTED is allowed", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ userId: "user-9", status: "UNDER_REVIEW" });
    updateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({});

    const result = await rejectProvider(PID, "Incomplete details");
    expect(result).toEqual({ ok: true });
    const auditArg = auditCreateMock.mock.calls[0]![0] as { data: { previousValue: unknown } };
    expect(auditArg.data.previousValue).toEqual({ status: "UNDER_REVIEW" });
  });

  it("mandatory reason: empty string → REASON_REQUIRED, no admin lookup, no write", async () => {
    const result = await rejectProvider(PID, "");
    expect(result).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("whitespace-only reason → REASON_REQUIRED", async () => {
    const result = await rejectProvider(PID, "   \n\t  ");
    expect(result).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("APPROVED cannot be rejected → PROVIDER_NOT_PENDING (no update attempted)", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ userId: "user-9", status: "APPROVED" });
    const result = await rejectProvider(PID, "reason");
    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("concurrent/stale transition (conditional update matches 0 rows) → PROVIDER_NOT_PENDING, no notification", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ userId: "user-9", status: "APPLIED" }); // passed the early guard
    updateManyMock.mockResolvedValue({ count: 0 }); // another admin already transitioned it
    const result = await rejectProvider(PID, "reason");
    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("PROVIDER_NOT_FOUND when the provider does not exist", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue(null);
    expect(await rejectProvider(PID, "reason")).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
  });

  it("still succeeds (rejection durable) even if the post-commit notification write throws", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ userId: "user-9", status: "APPLIED" });
    updateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});
    notificationCreateMock.mockRejectedValue(new Error("notification store down"));

    const result = await rejectProvider(PID, "reason");
    expect(result).toEqual({ ok: true });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
  });

  it("INVALID_INPUT for a non-uuid id (before any reason/admin work)", async () => {
    expect(await rejectProvider("not-a-uuid", "reason")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
