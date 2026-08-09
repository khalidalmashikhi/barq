import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}));

const configuredMock = vi.fn();
const signMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => configuredMock(),
  createSignedObjectUrl: (...a: unknown[]) => signMock(...a),
}));

const { getProviderDocumentSignedUrl } = await import("./get-provider-document-signed-url");

const KEY = "provider-documents/prov-1/identity_proof/x.jpg";
const row = { objectKey: KEY, providerId: "prov-1", originalFilename: "id.jpg" };

beforeEach(() => {
  configuredMock.mockReturnValue(true);
  signMock.mockResolvedValue("https://storage.example/signed?token=abc");
  findUniqueMock.mockResolvedValue({ ...row });
});
afterEach(() => vi.clearAllMocks());

describe("getProviderDocumentSignedUrl", () => {
  it("mints a signed URL (attachment) for the owning provider — never returns the objectKey", async () => {
    const view = await getProviderDocumentSignedUrl("doc-1", { kind: "provider", providerId: "prov-1" });
    expect(view).toEqual({ signedUrl: "https://storage.example/signed?token=abc", filename: "id.jpg" });
    // forces attachment download with the sanitized filename, short TTL
    expect(signMock).toHaveBeenCalledWith(KEY, 60, { downloadFilename: "id.jpg" });
    // the objectKey never appears in the returned value
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("returns null for a provider who does NOT own the document (no leak → 404)", async () => {
    const view = await getProviderDocumentSignedUrl("doc-1", { kind: "provider", providerId: "prov-2" });
    expect(view).toBeNull();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("allows an admin to view any provider's document", async () => {
    const view = await getProviderDocumentSignedUrl("doc-1", { kind: "admin" });
    expect(view?.signedUrl).toBe("https://storage.example/signed?token=abc");
  });

  it("returns null for a missing document", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getProviderDocumentSignedUrl("missing", { kind: "admin" })).toBeNull();
  });

  it("returns null (never a public fallback) when document storage is not configured", async () => {
    configuredMock.mockReturnValue(false);
    expect(await getProviderDocumentSignedUrl("doc-1", { kind: "admin" })).toBeNull();
    expect(signMock).not.toHaveBeenCalled();
  });
});
