import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B4 — revokeProviderActivity(): ACTIVE-admin-only; revokes ONLY an
// ADMIN-granted link; rejects SELF (primary) and LEGACY; blocks with
// ACTIVITY_IN_USE when the provider still has a service in that category (and the
// service is NEVER deleted/changed). The service-use check + delete are one txn.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const requireAdminMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const notifyProviderMock = vi.fn();
vi.mock("@/lib/notifications/provider-notification-events", () => ({
  PROVIDER_NOTIFICATION_EVENT: { ACTIVITY_REVOKED: "provider.activity_revoked" },
  notifyProviderOfEvent: (...a: unknown[]) => notifyProviderMock(...a),
}));

const providerFindUniqueMock = vi.fn();
const pcFindUniqueMock = vi.fn();
const pcDeleteMock = vi.fn();
const serviceCountMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...a: unknown[]) => providerFindUniqueMock(...a) },
    providerCategory: { findUnique: (...a: unknown[]) => pcFindUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        service: { count: (...a: unknown[]) => serviceCountMock(...a) },
        providerCategory: { delete: (...a: unknown[]) => pcDeleteMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { revokeProviderActivity } = await import("./revoke-provider-activity");

const PID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const CID = "019f4e4e-8116-7052-b15e-b79b5ccb1af0";

afterEach(() => {
  requireAdminMock.mockReset();
  notifyProviderMock.mockReset();
  providerFindUniqueMock.mockReset();
  pcFindUniqueMock.mockReset();
  pcDeleteMock.mockReset();
  serviceCountMock.mockReset();
  auditCreateMock.mockReset();
});

function adminOk() {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  providerFindUniqueMock.mockResolvedValue({ id: PID, userId: "user-9" });
}

describe("revokeProviderActivity", () => {
  it("revokes an ADMIN activity not used by any service — deletes, audits, notifies", async () => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue({ source: "ADMIN" });
    serviceCountMock.mockResolvedValue(0);
    pcDeleteMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    notifyProviderMock.mockResolvedValue(undefined);

    const result = await revokeProviderActivity(PID, CID);
    expect(result).toEqual({ ok: true });
    expect(pcDeleteMock).toHaveBeenCalledWith({ where: { providerId_categoryId: { providerId: PID, categoryId: CID } } });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.activity_revoked", actorType: "ADMIN" } });
    expect(notifyProviderMock).toHaveBeenCalledWith("provider.activity_revoked", { providerUserId: "user-9", providerId: PID });
  });

  it("BLOCKS with ACTIVITY_IN_USE when a service uses the activity — the service is never deleted", async () => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue({ source: "ADMIN" });
    serviceCountMock.mockResolvedValue(2); // provider has services in this category

    const result = await revokeProviderActivity(PID, CID);
    expect(result).toEqual({ ok: false, error: "ACTIVITY_IN_USE" });
    expect(pcDeleteMock).not.toHaveBeenCalled(); // nothing removed
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it.each(["SELF", "LEGACY"])("rejects revoking a %s link (NOT_REVOCABLE) — never removes the primary or a legacy link", async (source) => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue({ source });
    const result = await revokeProviderActivity(PID, CID);
    expect(result).toEqual({ ok: false, error: "NOT_REVOCABLE" });
    expect(serviceCountMock).not.toHaveBeenCalled();
    expect(pcDeleteMock).not.toHaveBeenCalled();
  });

  it("NOT_FOUND when no such link exists", async () => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue(null);
    expect(await revokeProviderActivity(PID, CID)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("rejects a non-admin (ForbiddenError → NO_ADMIN_PROFILE)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await revokeProviderActivity(PID, CID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });
});
