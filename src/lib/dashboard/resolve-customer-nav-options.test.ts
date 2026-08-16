import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Customer → Provider Journey (A) — resolveCustomerNavOptions() maps the
// caller's provider status to exactly one doorway state, and passes the admin
// flag through. It is a display resolver (never an auth gate), so it only
// reads status; RBAC enforcement stays in the require*() helpers.

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();
const hasActiveAdminProfileMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  hasActiveAdminProfile: (...a: unknown[]) => hasActiveAdminProfileMock(...a),
}));

const providerFindUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { provider: { findUnique: (...a: unknown[]) => providerFindUniqueMock(...a) } },
}));

const { resolveCustomerNavOptions } = await import("./resolve-customer-nav-options");

beforeEach(() => {
  requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
  hasActiveAdminProfileMock.mockResolvedValue(false);
});

afterEach(() => {
  requireAuthMock.mockReset();
  hasActiveAdminProfileMock.mockReset();
  providerFindUniqueMock.mockReset();
});

describe("resolveCustomerNavOptions — provider doorway mapping", () => {
  it("returns 'become' when the user has no provider profile", async () => {
    providerFindUniqueMock.mockResolvedValue(null);
    const result = await resolveCustomerNavOptions();
    expect(result.providerDoorway).toBe("become");
  });

  it("returns 'workspace' for an APPROVED provider", async () => {
    providerFindUniqueMock.mockResolvedValue({ status: "APPROVED" });
    const result = await resolveCustomerNavOptions();
    expect(result.providerDoorway).toBe("workspace");
  });

  it("returns 'application' for a pending provider (APPLIED / UNDER_REVIEW)", async () => {
    for (const status of ["APPLIED", "UNDER_REVIEW"]) {
      providerFindUniqueMock.mockResolvedValue({ status });
      const result = await resolveCustomerNavOptions();
      expect(result.providerDoorway).toBe("application");
    }
  });

  it("returns 'application' (not 'workspace') for a SUSPENDED / DEACTIVATED provider", async () => {
    for (const status of ["SUSPENDED", "DEACTIVATED"]) {
      providerFindUniqueMock.mockResolvedValue({ status });
      const result = await resolveCustomerNavOptions();
      // Their /provider workspace is gated off; the application page is the
      // correct destination for their status, never the workspace.
      expect(result.providerDoorway).toBe("application");
    }
  });

  it("passes the admin flag through", async () => {
    providerFindUniqueMock.mockResolvedValue(null);
    hasActiveAdminProfileMock.mockResolvedValue(true);
    const result = await resolveCustomerNavOptions();
    expect(result.isAdmin).toBe(true);
  });

  it("Gate A: suppresses the provider doorway entirely for an ACTIVE admin (backoffice-only)", async () => {
    // Even though this admin has no provider row (which would normally map to
    // 'become'), an active admin is never offered the customer→provider journey.
    providerFindUniqueMock.mockResolvedValue(null);
    hasActiveAdminProfileMock.mockResolvedValue(true);
    const result = await resolveCustomerNavOptions();
    expect(result.providerDoorway).toBeUndefined();
    expect(result.isAdmin).toBe(true);
  });
});
