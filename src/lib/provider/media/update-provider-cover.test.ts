import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const isStorageConfiguredMock = vi.fn();
const uploadObjectMock = vi.fn();
const getPublicObjectUrlMock = vi.fn();
const removeObjectMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isStorageConfigured: (...a: unknown[]) => isStorageConfiguredMock(...a),
  uploadObject: (...a: unknown[]) => uploadObjectMock(...a),
  getPublicObjectUrl: (...a: unknown[]) => getPublicObjectUrlMock(...a),
  removeObject: (...a: unknown[]) => removeObjectMock(...a),
}));

const mediaFindManyMock = vi.fn();
const mediaCreateMock = vi.fn();
const mediaDeleteManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        mediaAsset: {
          findMany: (...a: unknown[]) => mediaFindManyMock(...a),
          create: (...a: unknown[]) => mediaCreateMock(...a),
          deleteMany: (...a: unknown[]) => mediaDeleteManyMock(...a),
        },
      }),
  },
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { updateProviderCover } = await import("./update-provider-cover");

const file = (type: string, size: number) => new File([new Uint8Array(size)], "c", { type });

afterEach(() => vi.clearAllMocks());

describe("updateProviderCover", () => {
  it("creates a PROVIDER/COVER MediaAsset and audits cover_updated (no logoUrl touch)", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/cover.jpg");
    mediaFindManyMock.mockResolvedValue([]);
    mediaCreateMock.mockResolvedValue({ id: "cov-1" });
    recordAuditEventMock.mockResolvedValue({});

    const result = await updateProviderCover(file("image/jpeg", 4000), "prov-1");

    expect(result).toEqual({ ok: true, url: "https://ref.supabase.co/cover.jpg" });
    expect(mediaCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerType: "PROVIDER", kind: "COVER", providerId: "prov-1" }) })
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider.cover_updated", actorType: "PROVIDER" }),
      expect.anything()
    );
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("replaces the previous cover and cleans up its object", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/cover2.jpg");
    mediaFindManyMock.mockResolvedValue([{ id: "old", objectKey: "provider/prov-1/cover/old.jpg", url: "u" }]);
    mediaCreateMock.mockResolvedValue({ id: "cov-2" });
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateProviderCover(file("image/jpeg", 4000), "prov-1");

    expect(result.ok).toBe(true);
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({ where: { id: { in: ["old"] } } });
    expect(removeObjectMock).toHaveBeenCalledWith("provider/prov-1/cover/old.jpg");
  });

  it("rejects an unsupported type before upload", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    const result = await updateProviderCover(file("image/gif", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("declines when storage is not configured", async () => {
    isStorageConfiguredMock.mockReturnValue(false);
    const result = await updateProviderCover(file("image/png", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
  });

  it("cleans up the orphan object on DB failure", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/x.png");
    mediaFindManyMock.mockRejectedValue(new Error("db"));
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateProviderCover(file("image/png", 1000), "prov-1");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removeObjectMock).toHaveBeenCalledWith(expect.stringMatching(/^provider\/prov-1\/cover\/.+\.png$/));
  });
});
