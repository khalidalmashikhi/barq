import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Backoffice Hardening (Gate A) — domain-layer authorization test for
// getDashboardData(). Unlike the other Customer reads it takes an already-resolved
// barqUserId (its page caller runs requireAuth + redirects active admins), so the
// backoffice-only exclusion is enforced INSIDE the domain function too — a direct
// call from the BARQ API/iOS/Android or another server action is denied identically,
// before any Customer data is read.

vi.mock("server-only", () => ({}));

const assertNotActiveAdminMock = vi.fn();

class ForbiddenError extends Error {
  code?: string;
  constructor(message?: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("@/lib/auth", () => ({
  assertNotActiveAdmin: (...args: unknown[]) => assertNotActiveAdminMock(...args),
  ForbiddenError,
}));

vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/extract-localized-text", () => ({ extractLocalizedText: (v: unknown) => String(v) }));

const customerFindUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => customerFindUniqueMock(...a) },
    notification: { count: vi.fn() },
    booking: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    review: { count: vi.fn() },
    service: { findMany: vi.fn() },
  },
}));

const { getDashboardData } = await import("./get-dashboard-data");

afterEach(() => {
  assertNotActiveAdminMock.mockReset();
  customerFindUniqueMock.mockReset();
});

describe("getDashboardData (Gate A — domain-layer active-admin exclusion)", () => {
  it("denies an ACTIVE admin before any Customer read, even though it receives a raw barqUserId", async () => {
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const error = await getDashboardData("admin-user").catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("ADMIN_BACKOFFICE_ONLY");
    expect(assertNotActiveAdminMock).toHaveBeenCalledWith("admin-user");
    expect(customerFindUniqueMock).not.toHaveBeenCalled();
  });

  it("is a pass-through for a non-admin — the guard runs with the given id, then execution reaches the Customer lookup", async () => {
    assertNotActiveAdminMock.mockResolvedValue(undefined);
    // A sentinel at the Customer lookup proves execution proceeded past the guard
    // without blocking a normal user (no need to mock the whole dashboard fan-out).
    customerFindUniqueMock.mockImplementation(() => {
      throw new Error("REACHED_CUSTOMER_LOOKUP");
    });

    const error = await getDashboardData("user-1").catch((e) => e);

    expect(assertNotActiveAdminMock).toHaveBeenCalledWith("user-1");
    expect((error as Error).message).toBe("REACHED_CUSTOMER_LOOKUP");
  });
});
