import { describe, it, expect, vi, afterEach } from "vitest";

// Media Foundation (Gap C) — provider logo orchestration. Mocks the
// storage adapter (network) and prisma (DB) so the full replace/audit/
// cleanup flow is asserted without touching Supabase or Postgres.

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

const providerFindUniqueMock = vi.fn();
const providerUpdateMock = vi.fn();
const mediaFindManyMock = vi.fn();
const mediaCreateMock = vi.fn();
const mediaDeleteManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        provider: {
          findUnique: (...a: unknown[]) => providerFindUniqueMock(...a),
          update: (...a: unknown[]) => providerUpdateMock(...a),
        },
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

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { updateProviderLogo } = await import("./update-provider-logo");

function makeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "logo", { type });
}

function configuredHappyPath() {
  isStorageConfiguredMock.mockReturnValue(true);
  uploadObjectMock.mockResolvedValue(undefined);
  getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/storage/v1/object/public/media/x.png");
  providerFindUniqueMock.mockResolvedValue({ logoUrl: null });
  mediaFindManyMock.mockResolvedValue([]);
  mediaCreateMock.mockResolvedValue({ id: "media-new" });
  providerUpdateMock.mockResolvedValue({});
  mediaDeleteManyMock.mockResolvedValue({ count: 0 });
  recordAuditEventMock.mockResolvedValue({});
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateProviderLogo", () => {
  it("uploads, creates a PROVIDER/LOGO MediaAsset, repoints logoUrl, and audits atomically", async () => {
    configuredHappyPath();

    const result = await updateProviderLogo(makeFile("image/png", 2048), "prov-1");

    expect(result).toEqual({ ok: true, url: "https://ref.supabase.co/storage/v1/object/public/media/x.png" });

    expect(uploadObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringMatching(/^provider\/prov-1\/logo\/.+\.png$/),
        contentType: "image/png",
      })
    );
    expect(mediaCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerType: "PROVIDER",
          kind: "LOGO",
          providerId: "prov-1",
          mimeType: "image/png",
          sizeBytes: 2048,
          url: "https://ref.supabase.co/storage/v1/object/public/media/x.png",
        }),
      })
    );
    expect(providerUpdateMock).toHaveBeenCalledWith({
      where: { id: "prov-1" },
      data: { logoUrl: "https://ref.supabase.co/storage/v1/object/public/media/x.png" },
    });
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "prov-1",
        action: "provider.logo_updated",
        entityType: "Provider",
        entityId: "prov-1",
      }),
      expect.anything()
    );
    // No previous logo → nothing to delete or clean up.
    expect(mediaDeleteManyMock).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("on replace: deletes the previous LOGO row and cleans up its storage object", async () => {
    configuredHappyPath();
    providerFindUniqueMock.mockResolvedValue({ logoUrl: "https://ref.supabase.co/old.png" });
    mediaFindManyMock.mockResolvedValue([{ id: "media-old", objectKey: "provider/prov-1/logo/old.png" }]);
    mediaCreateMock.mockResolvedValue({ id: "media-new" });
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateProviderLogo(makeFile("image/webp", 1000), "prov-1");

    expect(result.ok).toBe(true);
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({ where: { id: { in: ["media-old"] } } });
    expect(removeObjectMock).toHaveBeenCalledWith("provider/prov-1/logo/old.png");
  });

  it("rejects an unsupported MIME type before any upload", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    const result = await updateProviderLogo(makeFile("image/svg+xml", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before any upload", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    const result = await updateProviderLogo(makeFile("image/png", 5 * 1024 * 1024 + 1), "prov-1");
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("declines politely when storage is not configured", async () => {
    isStorageConfiguredMock.mockReturnValue(false);
    const result = await updateProviderLogo(makeFile("image/png", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("returns UPLOAD_FAILED and writes nothing when the upload throws", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockRejectedValue(new Error("network"));
    const result = await updateProviderLogo(makeFile("image/png", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "UPLOAD_FAILED" });
    expect(mediaCreateMock).not.toHaveBeenCalled();
  });

  it("on DB failure after upload, cleans up the just-uploaded orphan object", async () => {
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/new.png");
    providerFindUniqueMock.mockRejectedValue(new Error("db down"));
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateProviderLogo(makeFile("image/png", 1000), "prov-1");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removeObjectMock).toHaveBeenCalledWith(expect.stringMatching(/^provider\/prov-1\/logo\/.+\.png$/));
  });
});
