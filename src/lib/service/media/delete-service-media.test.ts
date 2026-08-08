import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const removeObjectMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  removeObject: (...a: unknown[]) => removeObjectMock(...a),
}));

const findUniqueMock = vi.fn();
const mediaDeleteMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    mediaAsset: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ mediaAsset: { delete: (...a: unknown[]) => mediaDeleteMock(...a) } }),
  },
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { deleteServiceMedia } = await import("./delete-service-media");

afterEach(() => vi.clearAllMocks());

describe("deleteServiceMedia", () => {
  it("deletes an owned service media item and removes its storage object", async () => {
    findUniqueMock.mockResolvedValue({
      id: "m1",
      serviceId: "svc-1",
      kind: "GALLERY",
      objectKey: "service/svc-1/gallery/a.png",
      service: { providerId: "prov-1" },
    });
    mediaDeleteMock.mockResolvedValue({});
    recordAuditEventMock.mockResolvedValue({});
    removeObjectMock.mockResolvedValue(undefined);

    const result = await deleteServiceMedia("m1", "svc-1", "prov-1");

    expect(result).toEqual({ ok: true });
    expect(mediaDeleteMock).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(removeObjectMock).toHaveBeenCalledWith("service/svc-1/gallery/a.png");
  });

  it("returns NOT_FOUND when the asset does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await deleteServiceMedia("missing", "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when the asset belongs to a different service (crafted id)", async () => {
    findUniqueMock.mockResolvedValue({ id: "m1", serviceId: "other-svc", kind: "GALLERY", objectKey: "k", service: { providerId: "prov-1" } });
    const result = await deleteServiceMedia("m1", "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mediaDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects FORBIDDEN when the service belongs to another provider", async () => {
    findUniqueMock.mockResolvedValue({ id: "m1", serviceId: "svc-1", kind: "COVER", objectKey: "k", service: { providerId: "other" } });
    const result = await deleteServiceMedia("m1", "svc-1", "prov-1");
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mediaDeleteMock).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });
});
