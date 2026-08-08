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

const serviceFindUniqueMock = vi.fn();
const mediaFindManyMock = vi.fn();
const mediaCreateMock = vi.fn();
const mediaDeleteManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findUnique: (...a: unknown[]) => serviceFindUniqueMock(...a) },
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

const { updateServiceCover } = await import("./update-service-cover");

const file = (type: string, size: number) => new File([new Uint8Array(size)], "c", { type });

afterEach(() => vi.clearAllMocks());

describe("updateServiceCover", () => {
  it("creates a SERVICE/COVER MediaAsset for an owned service and audits", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/sc.jpg");
    mediaFindManyMock.mockResolvedValue([]);
    mediaCreateMock.mockResolvedValue({ id: "sc-1" });
    recordAuditEventMock.mockResolvedValue({});

    const result = await updateServiceCover(file("image/jpeg", 2000), "svc-1", "prov-1");

    expect(result).toEqual({ ok: true, url: "https://ref.supabase.co/sc.jpg" });
    expect(mediaCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerType: "SERVICE", kind: "COVER", serviceId: "svc-1" }) })
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service.cover_updated", entityId: "svc-1" }),
      expect.anything()
    );
  });

  it("returns NOT_FOUND when the service does not exist (no upload)", async () => {
    serviceFindUniqueMock.mockResolvedValue(null);
    const result = await updateServiceCover(file("image/png", 1000), "missing", "prov-1");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN when the service belongs to another provider (no upload)", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "other" });
    const result = await updateServiceCover(file("image/png", 1000), "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("replaces the previous cover and cleans up its object", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/sc2.jpg");
    mediaFindManyMock.mockResolvedValue([{ id: "old", objectKey: "service/svc-1/cover/old.jpg", url: "u" }]);
    mediaCreateMock.mockResolvedValue({ id: "sc-2" });
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateServiceCover(file("image/webp", 1000), "svc-1", "prov-1");

    expect(result.ok).toBe(true);
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({ where: { id: { in: ["old"] } } });
    expect(removeObjectMock).toHaveBeenCalledWith("service/svc-1/cover/old.jpg");
  });

  it("rejects an unsupported type before upload", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    isStorageConfiguredMock.mockReturnValue(true);
    const result = await updateServiceCover(file("image/gif", 1000), "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("cleans up the orphan object on DB failure", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/x.png");
    mediaFindManyMock.mockRejectedValue(new Error("db"));
    removeObjectMock.mockResolvedValue(undefined);

    const result = await updateServiceCover(file("image/png", 1000), "svc-1", "prov-1");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removeObjectMock).toHaveBeenCalledWith(expect.stringMatching(/^service\/svc-1\/cover\/.+\.png$/));
  });
});
