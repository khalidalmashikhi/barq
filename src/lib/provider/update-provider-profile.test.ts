import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Operations Foundation — regression tests for
// updateProviderProfile(), the new self-service Provider Settings
// action. Mirrors update-service.test.ts's mocking shape.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(message?: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

const updateMock = vi.fn();
const txUpdateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      update: (...args: unknown[]) => updateMock(...args),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ provider: { update: (...args: unknown[]) => txUpdateMock(...args) } }),
  },
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));

const { updateProviderProfile } = await import("./update-provider-profile");
const { ForbiddenError } = await import("@/lib/auth");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const VALID_FIELDS = {
  businessNameAr: "شركة الجبل الأخضر",
  businessNameEn: "Green Mountain Co",
  businessDescriptionAr: "",
  businessDescriptionEn: "",
  contactEmail: "",
  city: "",
  logoUrl: "",
};

afterEach(() => {
  requireProviderMock.mockReset();
  updateMock.mockReset();
  txUpdateMock.mockReset();
  recordAuditEventMock.mockReset();
});

describe("updateProviderProfile", () => {
  it("returns INVALID_INPUT when the business name is missing, without checking provider auth", async () => {
    const result = await updateProviderProfile(buildFormData({ ...VALID_FIELDS, businessNameAr: "", businessNameEn: "" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed contact email", async () => {
    const result = await updateProviderProfile(buildFormData({ ...VALID_FIELDS, contactEmail: "not-an-email" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed logo URL", async () => {
    const result = await updateProviderProfile(buildFormData({ ...VALID_FIELDS, logoUrl: "not-a-url" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when no Provider row exists at all", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError("Provider role required"));

    const result = await updateProviderProfile(buildFormData(VALID_FIELDS));

    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates only the allowed identity fields for an authenticated provider", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    updateMock.mockResolvedValue({});

    const result = await updateProviderProfile(
      buildFormData({
        ...VALID_FIELDS,
        businessDescriptionAr: "وصف",
        businessDescriptionEn: "Desc",
        contactEmail: "owner@example.com",
        city: "Salalah",
        logoUrl: "https://example.com/logo.png",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "provider-1" },
      data: {
        businessName: { ar: "شركة الجبل الأخضر", en: "Green Mountain Co" },
        businessDescription: { ar: "وصف", en: "Desc" },
        contactEmail: "owner@example.com",
        city: "Salalah",
        logoUrl: "https://example.com/logo.png",
      },
    });
  });

  it("clears the description when both language fields are blank", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    updateMock.mockResolvedValue({});

    await updateProviderProfile(buildFormData(VALID_FIELDS));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactEmail: null, city: null, logoUrl: null }),
      })
    );
  });

  it("persists a providerType change atomically and records a PROVIDER-attributed audit event", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "COMPANY" } });
    txUpdateMock.mockResolvedValue({});

    const result = await updateProviderProfile(buildFormData({ ...VALID_FIELDS, providerType: "INDIVIDUAL" }));

    expect(result).toEqual({ ok: true });
    // Ordinary (non-transactional) update path must NOT be used for a type change.
    expect(updateMock).not.toHaveBeenCalled();
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "provider-1" },
        data: expect.objectContaining({ providerType: "INDIVIDUAL" }),
      })
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "provider-1",
        action: "provider.type_changed",
        previousValue: { providerType: "COMPANY" },
        newValue: { providerType: "INDIVIDUAL" },
      }),
      expect.anything()
    );
  });

  it("does not record an audit event when the providerType is unchanged", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "COMPANY" } });
    updateMock.mockResolvedValue({});

    const result = await updateProviderProfile(buildFormData({ ...VALID_FIELDS, providerType: "COMPANY" }));

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerType: "COMPANY" }) })
    );
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
