import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B4 — grantProviderActivity(): ACTIVE-admin-only; creates source=ADMIN,
// isPrimary=false, grantedByAdminId from the session admin, grantedAt server-side;
// idempotent on an existing link WITHOUT rewriting SELF/LEGACY/ADMIN provenance.

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

const assertAssignableCategoryMock = vi.fn();
vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...a: unknown[]) => assertAssignableCategoryMock(...a),
}));

const notifyProviderMock = vi.fn();
vi.mock("@/lib/notifications/provider-notification-events", () => ({
  PROVIDER_NOTIFICATION_EVENT: { ACTIVITY_GRANTED: "provider.activity_granted" },
  notifyProviderOfEvent: (...a: unknown[]) => notifyProviderMock(...a),
}));

const providerFindUniqueMock = vi.fn();
const pcFindUniqueMock = vi.fn();
const pcCreateMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...a: unknown[]) => providerFindUniqueMock(...a) },
    providerCategory: { findUnique: (...a: unknown[]) => pcFindUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerCategory: { create: (...a: unknown[]) => pcCreateMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { grantProviderActivity } = await import("./grant-provider-activity");

const PID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const CID = "019f4e4e-8116-7052-b15e-b79b5ccb1af0";

afterEach(() => {
  requireAdminMock.mockReset();
  assertAssignableCategoryMock.mockReset();
  notifyProviderMock.mockReset();
  providerFindUniqueMock.mockReset();
  pcFindUniqueMock.mockReset();
  pcCreateMock.mockReset();
  auditCreateMock.mockReset();
});

function adminOk() {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  providerFindUniqueMock.mockResolvedValue({ id: PID, userId: "user-9" });
  assertAssignableCategoryMock.mockResolvedValue(true);
}

describe("grantProviderActivity", () => {
  it("creates an ADMIN grant: source=ADMIN, isPrimary=false, grantedByAdminId from session, grantedAt server-side; audits + notifies", async () => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue(null); // absent → create
    pcCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    notifyProviderMock.mockResolvedValue(undefined);

    const result = await grantProviderActivity(PID, CID);
    expect(result).toEqual({ ok: true });

    const data = (pcCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.providerId).toBe(PID);
    expect(data.categoryId).toBe(CID);
    expect(data.source).toBe("ADMIN");
    expect(data.isPrimary).toBe(false);
    expect(data.grantedByAdminId).toBe("admin-1"); // from session, never client
    expect(data.grantedAt).toBeInstanceOf(Date);

    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.activity_granted", actorType: "ADMIN" } });
    expect(notifyProviderMock).toHaveBeenCalledWith("provider.activity_granted", { providerUserId: "user-9", providerId: PID });
  });

  it.each(["SELF", "LEGACY", "ADMIN"])("is idempotent for an existing %s link — never rewrites provenance, never re-notifies", async (source) => {
    adminOk();
    pcFindUniqueMock.mockResolvedValue({ source }); // already linked
    const result = await grantProviderActivity(PID, CID);
    expect(result).toEqual({ ok: true });
    expect(pcCreateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(notifyProviderMock).not.toHaveBeenCalled();
  });

  it("rejects a non-admin (ForbiddenError → NO_ADMIN_PROFILE)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await grantProviderActivity(PID, CID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(pcCreateMock).not.toHaveBeenCalled();
  });

  it("PROVIDER_NOT_FOUND when the provider does not exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue(null);
    expect(await grantProviderActivity(PID, CID)).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
  });

  it("INVALID_CATEGORY for a non-selectable category", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PID, userId: "user-9" });
    assertAssignableCategoryMock.mockResolvedValue(false);
    expect(await grantProviderActivity(PID, CID)).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(pcCreateMock).not.toHaveBeenCalled();
  });

  it("INVALID_INPUT for a malformed provider/category id before any work", async () => {
    expect(await grantProviderActivity("not-a-uuid", CID)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });
});
