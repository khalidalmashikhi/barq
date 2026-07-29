import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2 (Provider Foundation) — regression tests for
// publishProvider()/unpublishProvider(). publishProvider() enforces
// BR-001: only an APPROVED provider may become visible.

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

const { publishProvider, unpublishProvider } = await import("./toggle-provider-visibility");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  providerFindUniqueMock.mockReset();
  providerUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("publishProvider", () => {
  it("sets visible=true and records action provider.published when the provider is APPROVED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID, status: "APPROVED", visible: false });
    providerUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await publishProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: true });
    expect(providerUpdateMock).toHaveBeenCalledWith({ where: { id: PROVIDER_ID }, data: { visible: true } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "provider.published", newValue: { visible: true } }),
    });
  });

  it("returns PROVIDER_NOT_APPROVED when the provider isn't APPROVED (BR-001)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID, status: "APPLIED", visible: false });

    const result = await publishProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_FOUND when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue(null);

    const result = await publishProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
  });
});

describe("unpublishProvider", () => {
  it("sets visible=false regardless of status and records action provider.unpublished", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID, status: "SUSPENDED", visible: true });
    providerUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await unpublishProvider(PROVIDER_ID);

    expect(result).toEqual({ ok: true });
    expect(providerUpdateMock).toHaveBeenCalledWith({ where: { id: PROVIDER_ID }, data: { visible: false } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "provider.unpublished", newValue: { visible: false } }),
    });
  });
});
