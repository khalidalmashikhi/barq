import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const docFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { assetDocument: { findFirst: (...a: unknown[]) => docFindFirstMock(...a) } } }));

const isConfiguredMock = vi.fn(() => true);
const createSignedObjectUrlMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => isConfiguredMock(),
  createSignedObjectUrl: (...a: unknown[]) => createSignedObjectUrlMock(...a),
}));

const { getVehicleDocumentSignedUrl } = await import("./get-vehicle-document-signed-url");

const VEHICLE = "asset-1";
const doc = { objectKey: "asset-documents/asset-1/vehicle_registration/x.pdf", originalFilename: "reg.pdf", asset: { providerId: "prov-1" } };

afterEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
});

describe("getVehicleDocumentSignedUrl", () => {
  it("mints a signed URL for the OWNING provider, scoped by vehicleId + docId", async () => {
    docFindFirstMock.mockResolvedValue(doc);
    createSignedObjectUrlMock.mockResolvedValue("https://signed/x");
    const view = await getVehicleDocumentSignedUrl(VEHICLE, "doc-1", { kind: "provider", providerId: "prov-1" });
    expect(view).toEqual({ signedUrl: "https://signed/x", filename: "reg.pdf" });
    // Path-binding: the lookup is scoped by assetId === vehicleId.
    expect(docFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc-1", assetId: "asset-1" } }));
    // 60-second TTL, keyed off the stored objectKey (never returned).
    expect(createSignedObjectUrlMock).toHaveBeenCalledWith(doc.objectKey, 60, expect.objectContaining({ downloadFilename: "reg.pdf" }));
  });

  it("PATH-BINDING: a document on another vehicle (assetId mismatch) yields null", async () => {
    // DB returns the row only when where.assetId matches the doc's real assetId.
    docFindFirstMock.mockImplementation((args: { where?: { assetId?: string } }) => Promise.resolve(args?.where?.assetId === "asset-1" ? doc : null));
    const view = await getVehicleDocumentSignedUrl("asset-2", "doc-1", { kind: "provider", providerId: "prov-1" });
    expect(view).toBeNull();
    expect(createSignedObjectUrlMock).not.toHaveBeenCalled();
  });

  it("returns null for a NON-owning provider (no cross-provider IDOR)", async () => {
    docFindFirstMock.mockResolvedValue(doc);
    expect(await getVehicleDocumentSignedUrl(VEHICLE, "doc-1", { kind: "provider", providerId: "prov-2" })).toBeNull();
    expect(createSignedObjectUrlMock).not.toHaveBeenCalled();
  });

  it("mints for an admin regardless of owner (still vehicle-scoped)", async () => {
    docFindFirstMock.mockResolvedValue(doc);
    createSignedObjectUrlMock.mockResolvedValue("https://signed/admin");
    const view = await getVehicleDocumentSignedUrl(VEHICLE, "doc-1", { kind: "admin" });
    expect(view?.signedUrl).toBe("https://signed/admin");
  });

  it("returns null for a missing document (uniform not-found)", async () => {
    docFindFirstMock.mockResolvedValue(null);
    expect(await getVehicleDocumentSignedUrl(VEHICLE, "doc-x", { kind: "admin" })).toBeNull();
  });

  it("returns null when storage is not configured", async () => {
    docFindFirstMock.mockResolvedValue(doc);
    isConfiguredMock.mockReturnValue(false);
    expect(await getVehicleDocumentSignedUrl(VEHICLE, "doc-1", { kind: "provider", providerId: "prov-1" })).toBeNull();
    expect(createSignedObjectUrlMock).not.toHaveBeenCalled();
  });
});
