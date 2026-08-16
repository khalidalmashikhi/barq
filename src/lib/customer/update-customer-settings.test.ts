import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

vi.mock("@/i18n/locales", () => ({ locales: ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const requireAuthMock = vi.fn();
const assertNotActiveAdminMock = vi.fn();

class ForbiddenError extends Error {
  code?: string;
  constructor(message?: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  assertNotActiveAdmin: (...args: unknown[]) => assertNotActiveAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError,
}));

const userUpdateMock = vi.fn();
const customerUpsertMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { update: (...args: unknown[]) => userUpdateMock(...args) },
        customer: { upsert: (...args: unknown[]) => customerUpsertMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateCustomerSettings } = await import("./update-customer-settings");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

afterEach(() => {
  requireAuthMock.mockReset();
  assertNotActiveAdminMock.mockReset();
  userUpdateMock.mockReset();
  customerUpsertMock.mockReset();
  auditCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("updateCustomerSettings", () => {
  it("updates the name + language and audits, in one transaction", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u1" } });
    userUpdateMock.mockResolvedValue({});
    customerUpsertMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateCustomerSettings(fd({ name: "Layla", languagePreference: "ar" }));

    expect(result).toEqual({ ok: true });
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: "Layla" } });
    expect(customerUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        update: { languagePreference: "ar" },
        create: { userId: "u1", languagePreference: "ar" },
      })
    );
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "account.settings_updated" }) });
  });

  it("rejects an unsupported language with INVALID_INPUT before any auth/DB work", async () => {
    const result = await updateCustomerSettings(fd({ name: "X", languagePreference: "xx" }));
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it("Gate A: denies an ACTIVE admin generically (UNKNOWN_ERROR) and never upserts a Customer row", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    // The backoffice-only exclusion fires before the transaction, so the lazy
    // Customer upsert never runs — an active admin cannot create a Customer profile.
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const result = await updateCustomerSettings(fd({ name: "Layla", languagePreference: "ar" }));

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(customerUpsertMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("clears name and language to null when submitted empty", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u1" } });
    userUpdateMock.mockResolvedValue({});
    customerUpsertMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await updateCustomerSettings(fd({ name: "  ", languagePreference: "" }));

    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: null } });
    expect(customerUpsertMock).toHaveBeenCalledWith(expect.objectContaining({ update: { languagePreference: null } }));
  });
});
