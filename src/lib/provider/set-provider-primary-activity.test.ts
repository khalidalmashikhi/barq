import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B4 — setProviderPrimaryActivity(): a provider self-selects EXACTLY ONE
// primary, editable ONLY while DRAFT. It atomically replaces ONLY the SELF row
// (deleteMany source=SELF + create) — ADMIN/LEGACY links are never touched — and
// the provider can never set source/isPrimary/grantedBy* (all server-fixed).

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const requireProviderMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const assertAssignableCategoryMock = vi.fn();
vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...a: unknown[]) => assertAssignableCategoryMock(...a),
}));

const findFirstMock = vi.fn();
const deleteManyMock = vi.fn();
const createMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerCategory: {
          findFirst: (...a: unknown[]) => findFirstMock(...a),
          deleteMany: (...a: unknown[]) => deleteManyMock(...a),
          create: (...a: unknown[]) => createMock(...a),
        },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { setProviderPrimaryActivity } = await import("./set-provider-primary-activity");

const CID = "019f4e4e-8116-7052-b15e-b79b5ccb1af0";
function fd(categoryId: string): FormData {
  const f = new FormData();
  if (categoryId) f.set("categoryId", categoryId);
  return f;
}

afterEach(() => {
  requireProviderMock.mockReset();
  assertAssignableCategoryMock.mockReset();
  findFirstMock.mockReset();
  deleteManyMock.mockReset();
  createMock.mockReset();
  auditCreateMock.mockReset();
});

describe("setProviderPrimaryActivity", () => {
  it("DRAFT: replaces ONLY the SELF primary (never ADMIN/LEGACY), creates SELF+primary, audits", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT" } });
    assertAssignableCategoryMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({ categoryId: "old-cat" });
    deleteManyMock.mockResolvedValue({ count: 1 });
    createMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setProviderPrimaryActivity(fd(CID));
    expect(result).toEqual({ ok: true });

    // Delete is scoped to source=SELF ONLY — admin/legacy rows are preserved.
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { providerId: "prov-1", source: "SELF" } });
    const data = (createMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ providerId: "prov-1", categoryId: CID, source: "SELF", isPrimary: true });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.primary_activity_changed", actorType: "PROVIDER" } });
  });

  it("is a no-op when the chosen category is already the primary", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT" } });
    assertAssignableCategoryMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({ categoryId: CID }); // unchanged
    const result = await setProviderPrimaryActivity(fd(CID));
    expect(result).toEqual({ ok: true });
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each(["APPLIED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SUSPENDED"])(
    "PRIMARY_LOCKED once the application is no longer DRAFT (%s) — the primary is not self-editable",
    async (status) => {
      requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status } });
      const result = await setProviderPrimaryActivity(fd(CID));
      expect(result).toEqual({ ok: false, error: "PRIMARY_LOCKED" });
      expect(deleteManyMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    }
  );

  it("INVALID_INPUT for an empty categoryId before any work", async () => {
    const result = await setProviderPrimaryActivity(fd(""));
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("INVALID_CATEGORY for a non-selectable category (DRAFT)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT" } });
    assertAssignableCategoryMock.mockResolvedValue(false);
    expect(await setProviderPrimaryActivity(fd(CID))).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});
