import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 0.1 (Foundation Hardening) — regression tests for
// duplicateService(), covering the BR-001 PROVIDER_NOT_APPROVED path
// this action's requireApprovedProvider() call enforces, alongside its
// existing ownership/clone logic (previously untested).

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireApprovedProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireApprovedProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(message?: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

const findUniqueMock = vi.fn();
const serviceCreateMock = vi.fn();
const priceCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { create: (...args: unknown[]) => serviceCreateMock(...args) },
        price: { create: (...args: unknown[]) => priceCreateMock(...args) },
      }),
  },
}));

const { duplicateService } = await import("./duplicate-service");
const { ForbiddenError } = await import("@/lib/auth");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  findUniqueMock.mockReset();
  serviceCreateMock.mockReset();
  priceCreateMock.mockReset();
});

describe("duplicateService", () => {
  it("returns INVALID_INPUT for a malformed service id without checking provider status", async () => {
    const result = await duplicateService("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_APPROVED without cloning anything when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED"));

    const result = await duplicateService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when no Provider row exists at all", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Provider role required"));

    const result = await duplicateService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND when the source service doesn't belong to this provider", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "someone-else", prices: [] });

    const result = await duplicateService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("clones name, description, serviceType, and the active price into a new DRAFT service", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({
      id: SERVICE_ID,
      providerId: "provider-1",
      serviceType: "EXPERIENCE",
      name: { ar: "جولة", en: "Tour" },
      description: { ar: "وصف", en: "Desc" },
      prices: [{ amount: "10.00", currency: "OMR" }],
    });
    serviceCreateMock.mockResolvedValue({ id: "service-2" });
    priceCreateMock.mockResolvedValue({});

    const result = await duplicateService(SERVICE_ID);

    expect(result).toEqual({ ok: true, serviceId: "service-2" });
    expect(serviceCreateMock).toHaveBeenCalledWith({
      data: {
        providerId: "provider-1",
        serviceType: "EXPERIENCE",
        name: { ar: "جولة", en: "Tour" },
        description: { ar: "وصف", en: "Desc" },
      },
    });
    expect(priceCreateMock).toHaveBeenCalledWith({
      data: { serviceId: "service-2", amount: "10.00", currency: "OMR" },
    });
  });

  it("clones a service with no active price without creating a Price row", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({
      id: SERVICE_ID,
      providerId: "provider-1",
      serviceType: "EXPERIENCE",
      name: { ar: "جولة", en: "Tour" },
      description: null,
      prices: [],
    });
    serviceCreateMock.mockResolvedValue({ id: "service-2" });

    const result = await duplicateService(SERVICE_ID);

    expect(result).toEqual({ ok: true, serviceId: "service-2" });
    expect(priceCreateMock).not.toHaveBeenCalled();
  });
});
