import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2 (Provider Foundation) — regression tests for
// archiveProvider(), which maps the phase's "Archive" request onto the
// existing ProviderStatus.DEACTIVATED value. Terminal: refuses if
// already DEACTIVATED.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const providerFindUniqueMock = vi.fn();
const providerUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: { update: (...args: unknown[]) => providerUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { archiveProvider } = await import("./archive-provider");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  providerFindUniqueMock.mockReset();
  providerUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("archiveProvider", () => {
  it("returns PROVIDER_NOT_FOUND when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue(null);

    const result = await archiveProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_STATUS_TRANSITION when already DEACTIVATED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID, status: "DEACTIVATED" });

    const result = await archiveProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it("archives an APPROVED provider and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID, status: "APPROVED" });
    providerUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: true });
    expect(providerUpdateMock).toHaveBeenCalledWith({ where: { id: PROVIDER_ID }, data: { status: "DEACTIVATED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "provider.archived",
        previousValue: { status: "APPROVED" },
        newValue: { status: "DEACTIVATED" },
      }),
    });
  });
});
