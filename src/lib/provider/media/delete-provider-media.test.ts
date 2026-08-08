import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const removeObjectMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  removeObject: (...a: unknown[]) => removeObjectMock(...a),
}));

const findUniqueMock = vi.fn();
const providerUpdateMock = vi.fn();
const mediaDeleteMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    mediaAsset: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        provider: { update: (...a: unknown[]) => providerUpdateMock(...a) },
        mediaAsset: { delete: (...a: unknown[]) => mediaDeleteMock(...a) },
      }),
  },
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { deleteProviderMedia } = await import("./delete-provider-media");

afterEach(() => vi.clearAllMocks());

describe("deleteProviderMedia", () => {
  it("deletes an owned portfolio image and removes its storage object", async () => {
    findUniqueMock.mockResolvedValue({ id: "m1", providerId: "prov-1", kind: "PORTFOLIO", objectKey: "provider/prov-1/portfolio/a.png", url: "u" });
    mediaDeleteMock.mockResolvedValue({});
    recordAuditEventMock.mockResolvedValue({});
    removeObjectMock.mockResolvedValue(undefined);

    const result = await deleteProviderMedia("m1", "prov-1");

    expect(result).toEqual({ ok: true });
    expect(mediaDeleteMock).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(providerUpdateMock).not.toHaveBeenCalled();
    expect(removeObjectMock).toHaveBeenCalledWith("provider/prov-1/portfolio/a.png");
  });

  it("clears logoUrl when deleting a LOGO asset", async () => {
    findUniqueMock.mockResolvedValue({ id: "m2", providerId: "prov-1", kind: "LOGO", objectKey: "provider/prov-1/logo/a.png", url: "u" });
    mediaDeleteMock.mockResolvedValue({});
    recordAuditEventMock.mockResolvedValue({});

    const result = await deleteProviderMedia("m2", "prov-1");

    expect(result).toEqual({ ok: true });
    expect(providerUpdateMock).toHaveBeenCalledWith({ where: { id: "prov-1" }, data: { logoUrl: null } });
  });

  it("returns NOT_FOUND when the asset does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await deleteProviderMedia("missing", "prov-1");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mediaDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects with FORBIDDEN when the asset belongs to another provider", async () => {
    findUniqueMock.mockResolvedValue({ id: "m3", providerId: "other-provider", kind: "PORTFOLIO", objectKey: "k", url: "u" });
    const result = await deleteProviderMedia("m3", "prov-1");
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mediaDeleteMock).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });
});
