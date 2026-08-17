import { describe, it, expect, vi, afterEach } from "vitest";

// Gate 1B / Gate B2 — requestProviderChanges() domain tests. Mirrors
// reject-provider.test.ts (requireAdmin + prisma mock). Proves: admin-only,
// mandatory reason, submitted-only transition to CHANGES_REQUESTED (reusing
// rejectionReason), audit, optimistic conditional guard, and — Gate B2 — that a
// provider.changes_requested IN_APP notification fires on the REAL transition and
// NOT on a no-op/raced one.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { requireAdminMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  UnauthenticatedError,
  ForbiddenError,
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

const { requestProviderChanges } = await import("./request-provider-changes");

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

describe("requestProviderChanges", () => {
  it.each(["APPLIED", "UNDER_REVIEW"])(
    "%s -> CHANGES_REQUESTED: stores the trimmed reason (rejectionReason), records audit, notifies the provider",
    async (status) => {
      adminOk();
      findUniqueMock.mockResolvedValue({ status, userId: "user-9" });
      updateManyMock.mockResolvedValue({ count: 1 });
      auditCreateMock.mockResolvedValue({});
      notificationCreateMock.mockResolvedValue({});

      const result = await requestProviderChanges(PID, "  Please upload a clearer ID  ");
      expect(result).toEqual({ ok: true });

      const arg = updateManyMock.mock.calls[0]![0] as {
        where: { id: string; status: { in: string[] } };
        data: { status: string; rejectionReason: string };
      };
      expect(arg.where.status.in).toEqual(["APPLIED", "UNDER_REVIEW"]);
      expect(arg.data.status).toBe("CHANGES_REQUESTED");
      expect(arg.data.rejectionReason).toBe("Please upload a clearer ID"); // trimmed
      const audit = auditCreateMock.mock.calls[0]![0] as { data: { action: string; actorType: string } };
      expect(audit.data.action).toBe("provider.changes_requested");
      expect(audit.data.actorType).toBe("ADMIN");

      // Gate B2 — provider notification on the real transition (static content;
      // the reason stays on /provider/verification, NOT in the notification body).
      expect(notificationCreateMock).toHaveBeenCalledTimes(1);
      const notif = notificationCreateMock.mock.calls[0]![0] as {
        data: { userId: string; channel: string; eventType: string; entityType: string; entityId: string; content: Record<string, unknown> };
      };
      expect(notif.data.userId).toBe("user-9");
      expect(notif.data.channel).toBe("IN_APP");
      expect(notif.data.eventType).toBe("provider.changes_requested");
      expect(notif.data.entityType).toBe("Provider");
      expect(notif.data.entityId).toBe(PID);
      expect(JSON.stringify(notif.data.content)).not.toContain("Please upload a clearer ID"); // no reason in body
    }
  );

  it("requires a non-empty reason", async () => {
    adminOk();
    expect(await requestProviderChanges(PID, "   ")).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid provider id before auth work", async () => {
    expect(await requestProviderChanges("not-a-uuid", "reason")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("non-admin (ForbiddenError) -> NO_ADMIN_PROFILE", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await requestProviderChanges(PID, "reason")).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it.each(["DRAFT", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED"])(
    "cannot request changes from non-submitted state %s -> PROVIDER_NOT_PENDING",
    async (status) => {
      adminOk();
      findUniqueMock.mockResolvedValue({ status });
      expect(await requestProviderChanges(PID, "reason")).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
      expect(updateManyMock).not.toHaveBeenCalled();
    }
  );

  it("PROVIDER_NOT_FOUND when the provider does not exist", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue(null);
    expect(await requestProviderChanges(PID, "reason")).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
  });

  it("optimistic race: updateMany count 0 -> PROVIDER_NOT_PENDING, no audit, no notification", async () => {
    adminOk();
    findUniqueMock.mockResolvedValue({ status: "UNDER_REVIEW", userId: "user-9" });
    updateManyMock.mockResolvedValue({ count: 0 });
    expect(await requestProviderChanges(PID, "reason")).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(auditCreateMock).not.toHaveBeenCalled();
    // Idempotency: no real transition -> no notification.
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});
