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

const countMock = vi.fn();
const mediaCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
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

const { addProviderPortfolioImage } = await import("./add-provider-portfolio-image");

const file = (type: string, size: number) => new File([new Uint8Array(size)], "p", { type });

afterEach(() => vi.clearAllMocks());

describe("addProviderPortfolioImage", () => {
  it("adds a PORTFOLIO MediaAsset and audits portfolio_added", async () => {
    countMock.mockResolvedValue(2);
    isStorageConfiguredMock.mockReturnValue(true);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/p.png");
    uploadObjectMock.mockResolvedValue(undefined);
    mediaCreateMock.mockResolvedValue({ id: "pf-1" });
    recordAuditEventMock.mockResolvedValue({});

    const result = await addProviderPortfolioImage(file("image/png", 1000), "prov-1");

    expect(result).toEqual({ ok: true, url: "https://ref.supabase.co/p.png" });
    expect(mediaCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "PORTFOLIO", providerId: "prov-1" }) })
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider.portfolio_added" }),
      expect.anything()
    );
  });

  it("rejects with LIMIT_REACHED at the cap, without uploading", async () => {
    countMock.mockResolvedValue(12);
    const result = await addProviderPortfolioImage(file("image/png", 1000), "prov-1");
    expect(result).toEqual({ ok: false, error: "LIMIT_REACHED" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("cleans up the orphan object on DB failure", async () => {
    countMock.mockResolvedValue(0);
    isStorageConfiguredMock.mockReturnValue(true);
    getPublicObjectUrlMock.mockReturnValue("https://ref.supabase.co/p.png");
    uploadObjectMock.mockResolvedValue(undefined);
    mediaCreateMock.mockRejectedValue(new Error("db"));
    removeObjectMock.mockResolvedValue(undefined);

    const result = await addProviderPortfolioImage(file("image/png", 1000), "prov-1");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removeObjectMock).toHaveBeenCalled();
  });
});
