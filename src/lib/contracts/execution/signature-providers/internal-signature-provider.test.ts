import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { internalSignatureProvider } = await import("./internal-signature-provider");

// Phase E.3 — regression test for the Internal Signature provider:
// confirms it declares the correct key/method and returns a real
// signedAt timestamp with no external side effects.

describe("internalSignatureProvider", () => {
  it("declares key INTERNAL and method INTERNAL", () => {
    expect(internalSignatureProvider.key).toBe("INTERNAL");
    expect(internalSignatureProvider.method).toBe("INTERNAL");
  });

  it("sign() resolves with a real Date and no providerReference", async () => {
    const before = Date.now();
    const result = await internalSignatureProvider.sign({ contractId: "contract-1", signerType: "CUSTOMER" });
    const after = Date.now();

    expect(result.signedAt).toBeInstanceOf(Date);
    expect(result.signedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.signedAt.getTime()).toBeLessThanOrEqual(after);
    expect(result.providerReference).toBeUndefined();
  });
});
