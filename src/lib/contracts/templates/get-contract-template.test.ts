import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getContractTemplate } = await import("./get-contract-template");
const { standardServiceTemplate, premiumServiceTemplate, corporateTemplate } = await import("./service-templates");

// Phase E.2 — regression tests for the template factory: "switching
// providers should require configuration only" (mirroring Phase D.4's
// OTP provider factory principle) — confirms each real key resolves to
// its documented template by reference, that GOVERNMENT is recognized
// but explicitly rejected (reserved, not yet implemented), and that a
// genuinely unknown key fails loudly rather than silently defaulting.

describe("getContractTemplate", () => {
  it("resolves STANDARD_SERVICE, PREMIUM_SERVICE, and CORPORATE by reference", () => {
    expect(getContractTemplate("STANDARD_SERVICE")).toBe(standardServiceTemplate);
    expect(getContractTemplate("PREMIUM_SERVICE")).toBe(premiumServiceTemplate);
    expect(getContractTemplate("CORPORATE")).toBe(corporateTemplate);
  });

  it("throws a clear, distinct error for the reserved GOVERNMENT key", () => {
    expect(() => getContractTemplate("GOVERNMENT")).toThrow(/reserved future template/);
  });

  it("throws for a genuinely unknown key", () => {
    expect(() => getContractTemplate("NOT_A_REAL_KEY" as never)).toThrow(/unknown template key/);
  });
});
