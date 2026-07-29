import { describe, it, expect, vi } from "vitest";

// Phase E.3 — regression tests for the signature provider factory:
// mirrors get-contract-template.ts's (Phase E.2) reserved-key pattern.

vi.mock("server-only", () => ({}));

const { getSignatureProvider } = await import("./get-signature-provider");
const { internalSignatureProvider } = await import("./internal-signature-provider");

describe("getSignatureProvider", () => {
  it("resolves INTERNAL by reference", () => {
    expect(getSignatureProvider("INTERNAL")).toBe(internalSignatureProvider);
  });

  it.each(["GOVERNMENT_PKI", "ADOBE_SIGN", "DOCUSIGN", "OMAN_TRUST_SERVICES"] as const)(
    "throws a clear, distinct error for the reserved %s key",
    (key) => {
      expect(() => getSignatureProvider(key)).toThrow(/reserved future signature provider/);
    }
  );

  it("throws for a genuinely unknown key", () => {
    expect(() => getSignatureProvider("NOT_A_REAL_KEY" as never)).toThrow(/unknown signature provider key/);
  });
});
