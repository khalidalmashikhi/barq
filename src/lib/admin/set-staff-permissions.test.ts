import { describe, it, expect, vi, beforeEach } from "vitest";

// STAFF RBAC (Gate Z-3) — the OWNER-only staff-permission authority editor.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return { requireOwner: vi.fn(), staffFind: vi.fn(), staffUpdate: vi.fn(), auditCreate: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("@/lib/auth", async () => {
  const perms = await vi.importActual<typeof import("@/lib/auth/permissions")>("@/lib/auth/permissions");
  return {
    requireOwner: (...a: unknown[]) => h.requireOwner(...a),
    UnauthenticatedError: h.UnauthenticatedError,
    ForbiddenError: h.ForbiddenError,
    sanitizePermissionKeys: perms.sanitizePermissionKeys,
    isStaffPresetName: perms.isStaffPresetName,
    presetPermissions: perms.presetPermissions,
  };
});
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => h.auditCreate(...a) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    staff: { findUnique: (...a: unknown[]) => h.staffFind(...a), update: (...a: unknown[]) => h.staffUpdate(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ staff: { update: (...a: unknown[]) => h.staffUpdate(...a) }, auditLog: {} }),
  },
}));

const { setStaffPermissions } = await import("./set-staff-permissions");
const STAFF_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

beforeEach(() => {
  Object.values(h).forEach((v) => typeof v === "function" && "mockReset" in v && v.mockReset());
  h.requireOwner.mockResolvedValue({ admin: { id: "owner-1" } });
  h.staffFind.mockResolvedValue({ id: STAFF_ID, permissions: [] });
  h.staffUpdate.mockResolvedValue({});
  h.auditCreate.mockResolvedValue(undefined);
});

describe("setStaffPermissions", () => {
  it("OWNER applies a preset → stores its exact keys, audits preset_applied", async () => {
    const r = await setStaffPermissions(STAFF_ID, { preset: "PROVIDER_VERIFICATION" });
    expect(r).toEqual({ ok: true, permissions: ["providers.read", "providers.review", "providerDocuments.read"] });
    expect(h.staffUpdate).toHaveBeenCalledWith({ where: { id: STAFF_ID }, data: { permissions: ["providers.read", "providers.review", "providerDocuments.read"] } });
    expect(h.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.preset_applied", actorId: "owner-1" }), expect.anything());
  });

  it("OWNER sets an explicit list → sanitized (junk dropped, canonical order), audits permissions_changed", async () => {
    const r = await setStaffPermissions(STAFF_ID, { permissions: ["reviews.moderate", "bogus", "bookings.read", "reviews.moderate"] });
    expect(r).toEqual({ ok: true, permissions: ["bookings.read", "reviews.moderate"] });
    expect(h.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.permissions_changed" }), expect.anything());
  });

  it("empty set is valid (revokes all operational access)", async () => {
    const r = await setStaffPermissions(STAFF_ID, { permissions: [] });
    expect(r).toEqual({ ok: true, permissions: [] });
    expect(h.staffUpdate).toHaveBeenCalledWith({ where: { id: STAFF_ID }, data: { permissions: [] } });
  });

  it("invalid preset name → INVALID_INPUT, no write", async () => {
    const r = await setStaffPermissions(STAFF_ID, { preset: "SUPERUSER" });
    expect(r).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(h.staffUpdate).not.toHaveBeenCalled();
  });

  it("invalid staffId → INVALID_INPUT before any auth/DB", async () => {
    const r = await setStaffPermissions("not-a-uuid", { preset: "SUPPORT" });
    expect(r).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(h.requireOwner).not.toHaveBeenCalled();
  });

  it("non-owner (requireOwner throws ForbiddenError) → NO_ADMIN_PROFILE, no write", async () => {
    h.requireOwner.mockRejectedValue(new h.ForbiddenError());
    const r = await setStaffPermissions(STAFF_ID, { preset: "SUPPORT" });
    expect(r).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(h.staffUpdate).not.toHaveBeenCalled();
  });

  it("staff not found → STAFF_NOT_FOUND", async () => {
    h.staffFind.mockResolvedValue(null);
    const r = await setStaffPermissions(STAFF_ID, { preset: "SUPPORT" });
    expect(r).toEqual({ ok: false, error: "STAFF_NOT_FOUND" });
  });
});
