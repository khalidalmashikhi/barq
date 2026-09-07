import { describe, it, expect, vi, beforeEach } from "vitest";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Choose-usage is server-authoritative:
// input validated, and the declared type is changeable ONLY while UNCLASSIFIED (locked
// after finalization).

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  return { requireAuth: vi.fn(), resolveEffectiveAccountType: vi.fn(), userUpdate: vi.fn(), UnauthenticatedError };
});

vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  resolveEffectiveAccountType: (...a: unknown[]) => h.resolveEffectiveAccountType(...a),
  UnauthenticatedError: h.UnauthenticatedError,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update: (...a: unknown[]) => h.userUpdate(...a) } } }));

const { setAccountType } = await import("./set-account-type");

beforeEach(() => {
  h.requireAuth.mockReset();
  h.resolveEffectiveAccountType.mockReset();
  h.userUpdate.mockReset();
  h.requireAuth.mockResolvedValue({ barqUser: { id: "u1" } });
  h.resolveEffectiveAccountType.mockResolvedValue("UNCLASSIFIED");
  h.userUpdate.mockResolvedValue({});
});

describe("setAccountType", () => {
  it("writes CUSTOMER intent while UNCLASSIFIED", async () => {
    expect(await setAccountType("CUSTOMER")).toEqual({ ok: true });
    expect(h.userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { accountType: "CUSTOMER" } });
  });

  it("writes PROVIDER intent while UNCLASSIFIED", async () => {
    expect(await setAccountType("PROVIDER")).toEqual({ ok: true });
    expect(h.userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { accountType: "PROVIDER" } });
  });

  it("allows changing the choice before finalization (still UNCLASSIFIED)", async () => {
    await setAccountType("CUSTOMER");
    await setAccountType("PROVIDER");
    expect(h.userUpdate).toHaveBeenLastCalledWith({ where: { id: "u1" }, data: { accountType: "PROVIDER" } });
  });

  it("rejects a tampered/invalid type BEFORE touching auth or the DB", async () => {
    expect(await setAccountType("ADMIN" as never)).toEqual({ ok: false, error: "INVALID_TYPE" });
    expect(await setAccountType("" as never)).toEqual({ ok: false, error: "INVALID_TYPE" });
    expect(h.requireAuth).not.toHaveBeenCalled();
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it("LOCKS after finalization: any classified effective type → ALREADY_CLASSIFIED, no write", async () => {
    for (const t of ["CUSTOMER", "PROVIDER", "ADMIN", "STAFF"] as const) {
      h.resolveEffectiveAccountType.mockResolvedValue(t);
      expect(await setAccountType("PROVIDER")).toEqual({ ok: false, error: "ALREADY_CLASSIFIED" });
    }
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
});
