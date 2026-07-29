import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 0.1 (Foundation Hardening) — regression tests for
// createService(), covering the BR-001 PROVIDER_NOT_APPROVED path this
// action's requireApprovedProvider() call enforces, alongside its
// existing validation and creation logic (previously untested).

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

const serviceCreateMock = vi.fn();
const priceCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { create: (...args: unknown[]) => serviceCreateMock(...args) },
        price: { create: (...args: unknown[]) => priceCreateMock(...args) },
      }),
  },
}));

const { createService } = await import("./create-service");
const { ForbiddenError } = await import("@/lib/auth");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  serviceCreateMock.mockReset();
  priceCreateMock.mockReset();
});

describe("createService", () => {
  it("returns INVALID_INPUT without checking provider status when required fields are missing", async () => {
    const result = await createService(buildFormData({ nameAr: "", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_APPROVED without creating anything when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED"));

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when no Provider row exists at all", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Provider role required"));

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("creates the service and its price, in the same transaction, for an approved provider", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10.50" }));

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(serviceCreateMock).toHaveBeenCalledWith({
      data: {
        providerId: "provider-1",
        serviceType: "EXPERIENCE",
        name: { ar: "جولة", en: "Tour" },
        description: undefined,
      },
    });
    expect(priceCreateMock).toHaveBeenCalledWith({
      data: { serviceId: "service-1", amount: "10.50", currency: "OMR" },
    });
  });
});
