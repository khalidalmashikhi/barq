import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildInvoiceContent } = await import("./build-invoice-content");

describe("buildInvoiceContent", () => {
  it("builds a bilingual { ar, en } object with the real service name and amount embedded", () => {
    const result = buildInvoiceContent({
      serviceName: { ar: "جولة صحراوية", en: "Desert Tour" },
      amount: "15.00",
      currency: "OMR",
    });

    expect(result.en).toContain("Desert Tour");
    expect(result.en).toContain("15.00");
    expect(result.en).toContain("OMR");
    expect(result.ar).toContain("جولة صحراوية");
    expect(result.ar).toContain("15.00");
    expect(result.ar).toContain("OMR");
  });

  it("never localizes the amount or currency themselves — identical numerals in both languages", () => {
    const result = buildInvoiceContent({
      serviceName: { ar: "أ", en: "A" },
      amount: "42.00",
      currency: "OMR",
    });

    // The amount/currency substring must appear verbatim in both — no
    // Arabic-Indic digit conversion or translated currency label.
    expect(result.ar.includes("42.00 OMR")).toBe(true);
    expect(result.en.includes("42.00 OMR")).toBe(true);
  });
});
