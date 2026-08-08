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
const countMock = vi.fn();
const mediaCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findUnique: (...a: unknown[]) => serviceFindUniqueMock(...a) },
    mediaAsset: { count: (...a: unknown[]) => countMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ mediaAsset: { create: (...a: unknown[]) => mediaCreateMock(...a) } }),
  },
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { addServiceGalleryImage } = await import("./add-service-gallery-image");

const file = (type: string, size: number) => new File([new Uint8Array(size)], "g", { type });

afterEach(() => vi.clearAllMocks());

describe("addServiceGalleryImage", () => {
  it("adds a SERVICE/GALLERY MediaAsset for an owned service and audits", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    countMock.mockResolvedValue(1);
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/g.png");
    mediaCreateMock.mockResolvedValue({ id: "g-1" });
    recordAuditEventMock.mockResolvedValue({});

    const result = await addServiceGalleryImage(file("image/png", 1000), "svc-1", "prov-1");

    expect(result).toEqual({ ok: true, url: "https://ref.supabase.co/g.png" });
    expect(mediaCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "GALLERY", serviceId: "svc-1" }) })
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service.gallery_added" }),
      expect.anything()
    );
  });

  it("rejects FORBIDDEN for another provider's service without counting or uploading", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "other" });
    const result = await addServiceGalleryImage(file("image/png", 1000), "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(countMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects LIMIT_REACHED at the cap without uploading", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    countMock.mockResolvedValue(12);
    const result = await addServiceGalleryImage(file("image/png", 1000), "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "LIMIT_REACHED" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("cleans up the orphan object on DB failure", async () => {
    serviceFindUniqueMock.mockResolvedValue({ providerId: "prov-1" });
    countMock.mockResolvedValue(0);
    isStorageConfiguredMock.mockReturnValue(true);
    uploadObjectMock.mockResolvedValue(undefined);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/g.png");
    mediaCreateMock.mockRejectedValue(new Error("db"));
    removeObjectMock.mockResolvedValue(undefined);

    const result = await addServiceGalleryImage(file("image/png", 1000), "svc-1", "prov-1");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removeObjectMock).toHaveBeenCalled();
  });
});
