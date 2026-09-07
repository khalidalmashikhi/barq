import { describe, it, expect, vi, beforeEach } from "vitest";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Proves finalize creates EXACTLY the
// declared profile, is idempotent, fails closed on any opposite/dual profile (never
// creating a second one, never deleting), and resolves the concurrent-finalize race to
// a single profile.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  return {
    requireAuth: vi.fn(),
    resolveEffectiveAccountType: vi.fn(),
    getCred: vi.fn(),
    txCustomerFind: vi.fn(),
    txProviderFind: vi.fn(),
    txCustomerCreate: vi.fn(),
    txProviderCreate: vi.fn(),
    customerFind: vi.fn(),
    providerFind: vi.fn(),
    UnauthenticatedError,
  };
});

vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  resolveEffectiveAccountType: (...a: unknown[]) => h.resolveEffectiveAccountType(...a),
  UnauthenticatedError: h.UnauthenticatedError,
}));
vi.mock("@/lib/auth/customer-credential-state", () => ({ getCustomerCredentialState: (...a: unknown[]) => h.getCred(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// P2002 helper matching the source's isUniqueViolation (Prisma.PrismaClientKnownRequestError code P2002).
class P2002 extends Error {
  code = "P2002";
  clientVersion = "5";
}
vi.mock("@prisma/client", () => ({ Prisma: { PrismaClientKnownRequestError: P2002 } }));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => h.customerFind(...a) },
    provider: { findUnique: (...a: unknown[]) => h.providerFind(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        customer: { findUnique: (...a: unknown[]) => h.txCustomerFind(...a), create: (...a: unknown[]) => h.txCustomerCreate(...a) },
        provider: { findUnique: (...a: unknown[]) => h.txProviderFind(...a), create: (...a: unknown[]) => h.txProviderCreate(...a) },
      }),
  },
}));

const { finalizeRegistration } = await import("./finalize-registration");

const USER = { id: "u1", name: "Sara Al Amri", accountType: "CUSTOMER" as "CUSTOMER" | "PROVIDER" };

beforeEach(() => {
  Object.values(h).forEach((v) => typeof v === "function" && "mockReset" in v && v.mockReset());
  h.requireAuth.mockResolvedValue({ barqUser: { ...USER } });
  h.getCred.mockResolvedValue({ authenticated: true, hasVerifiedPhone: true, hasVerifiedEmail: true, isComplete: true });
  h.txCustomerFind.mockResolvedValue(null);
  h.txProviderFind.mockResolvedValue(null);
  h.txCustomerCreate.mockResolvedValue({ id: "c1" });
  h.txProviderCreate.mockResolvedValue({ id: "p1" });
});

describe("finalizeRegistration", () => {
  it("CUSTOMER intent → creates exactly one Customer, zero Provider", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "CUSTOMER" } });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: true });
    expect(h.txCustomerCreate).toHaveBeenCalledTimes(1);
    expect(h.txProviderCreate).not.toHaveBeenCalled();
  });

  it("PROVIDER intent → creates exactly one DRAFT Provider (businessName from name), zero Customer", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "PROVIDER" } });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: true });
    expect(h.txProviderCreate).toHaveBeenCalledTimes(1);
    expect(h.txCustomerCreate).not.toHaveBeenCalled();
    const arg = h.txProviderCreate.mock.calls[0]![0] as { data: { status: string; businessName: { en: string; ar: string } } };
    expect(arg.data.status).toBe("DRAFT");
    expect(arg.data.businessName).toEqual({ ar: "Sara Al Amri", en: "Sara Al Amri" });
  });

  it("idempotent: CUSTOMER already has a Customer → ok, no second create", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "CUSTOMER" } });
    h.txCustomerFind.mockResolvedValue({ id: "c1" });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: true });
    expect(h.txCustomerCreate).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED: CUSTOMER intent but a Provider exists → PROFILE_CONFLICT, no create, no delete", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "CUSTOMER" } });
    h.txProviderFind.mockResolvedValue({ id: "p1" });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: false, error: "PROFILE_CONFLICT" });
    expect(h.txCustomerCreate).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED: PROVIDER intent but a Customer exists → PROFILE_CONFLICT", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "PROVIDER" } });
    h.txCustomerFind.mockResolvedValue({ id: "c1" });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: false, error: "PROFILE_CONFLICT" });
    expect(h.txProviderCreate).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED: an existing dual (customer+provider) → PROFILE_CONFLICT", async () => {
    h.txCustomerFind.mockResolvedValue({ id: "c1" });
    h.txProviderFind.mockResolvedValue({ id: "p1" });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: false, error: "PROFILE_CONFLICT" });
  });

  it("no declared type → NO_DECLARED_TYPE (never creates anything)", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: null } });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: false, error: "NO_DECLARED_TYPE" });
    expect(h.txCustomerCreate).not.toHaveBeenCalled();
    expect(h.txProviderCreate).not.toHaveBeenCalled();
  });

  it("missing name → NAME_REQUIRED", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, name: "   ", accountType: "CUSTOMER" } });
    expect(await finalizeRegistration()).toEqual({ ok: false, error: "NAME_REQUIRED" });
  });

  it("unverified real email → EMAIL_NOT_VERIFIED (synthetic email never finalizes)", async () => {
    h.getCred.mockResolvedValue({ authenticated: true, hasVerifiedPhone: true, hasVerifiedEmail: false, isComplete: false });
    expect(await finalizeRegistration()).toEqual({ ok: false, error: "EMAIL_NOT_VERIFIED" });
  });

  it("unverified phone → PHONE_NOT_VERIFIED", async () => {
    h.getCred.mockResolvedValue({ authenticated: true, hasVerifiedPhone: false, hasVerifiedEmail: true, isComplete: false });
    expect(await finalizeRegistration()).toEqual({ ok: false, error: "PHONE_NOT_VERIFIED" });
  });

  it("concurrent finalize (P2002) → re-reads the winner; correct single profile is idempotent ok", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "CUSTOMER" } });
    h.txCustomerCreate.mockRejectedValue(new P2002("unique"));
    // The winning transaction produced exactly the Customer.
    h.customerFind.mockResolvedValue({ id: "c1" });
    h.providerFind.mockResolvedValue(null);
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: true });
  });

  it("concurrent finalize (P2002) but the winner produced the OPPOSITE profile → PROFILE_CONFLICT", async () => {
    h.requireAuth.mockResolvedValue({ barqUser: { ...USER, accountType: "CUSTOMER" } });
    h.txCustomerCreate.mockRejectedValue(new P2002("unique"));
    h.customerFind.mockResolvedValue(null);
    h.providerFind.mockResolvedValue({ id: "p1" });
    const r = await finalizeRegistration();
    expect(r).toEqual({ ok: false, error: "PROFILE_CONFLICT" });
  });
});
