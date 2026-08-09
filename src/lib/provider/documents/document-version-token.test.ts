import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { documentVersionToken } = await import("./document-version-token");

describe("documentVersionToken", () => {
  it("is deterministic for the same objectKey", () => {
    const key = "provider-documents/p1/identity_proof/u1.pdf";
    expect(documentVersionToken(key)).toBe(documentVersionToken(key));
  });

  it("changes when the objectKey changes (a replacement mints a new key)", () => {
    const a = documentVersionToken("provider-documents/p1/identity_proof/u1.pdf");
    const b = documentVersionToken("provider-documents/p1/identity_proof/u2.pdf");
    expect(a).not.toBe(b);
  });

  it("does not reveal the objectKey (opaque, 64-hex SHA-256)", () => {
    const key = "provider-documents/p1/identity_proof/secret-uuid.pdf";
    const token = documentVersionToken(key);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain("secret-uuid");
    expect(token).not.toContain("p1");
  });
});
