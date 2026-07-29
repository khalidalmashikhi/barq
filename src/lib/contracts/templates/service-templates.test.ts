import { describe, it, expect, vi } from "vitest";
import type { ContractRenderContext } from "./template";

vi.mock("server-only", () => ({}));

const { standardServiceTemplate, premiumServiceTemplate, corporateTemplate } = await import("./service-templates");

// Phase E.2 — regression tests for the concrete templates: confirms
// rendering actually substitutes the given context (not static,
// hardcoded text regardless of input — requirement #4's "do not
// hardcode template text"), that every section is bilingual (both `ar`
// and `en` populated), and that Premium/Corporate add their extra
// section on top of the shared base rather than replacing it.

const context: ContractRenderContext = {
  bookingId: "booking-1",
  contractNumber: "BARQ-2026-000123",
  serviceName: { ar: "جولة سياحية", en: "City Tour" },
  providerName: { ar: "شركة الرحلات", en: "Travel Co" },
  priceAmount: "45.00",
  priceCurrency: "OMR",
  seats: 3,
  generatedAt: new Date("2026-07-20T00:00:00Z"),
};

describe("standardServiceTemplate", () => {
  it("substitutes the render context into its sections", () => {
    const content = standardServiceTemplate.render(context);

    expect(content.title.en).toBe("Standard Service Contract");
    const serialized = JSON.stringify(content);
    expect(serialized).toContain("City Tour");
    expect(serialized).toContain("جولة سياحية");
    expect(serialized).toContain("Travel Co");
    expect(serialized).toContain("BARQ-2026-000123");
    expect(serialized).toContain("45.00");
    expect(serialized).toContain("OMR");
  });

  it("every section has both ar and en populated", () => {
    const content = standardServiceTemplate.render(context);
    for (const section of content.sections) {
      expect(section.heading.ar.length).toBeGreaterThan(0);
      expect(section.heading.en.length).toBeGreaterThan(0);
      expect(section.body.ar.length).toBeGreaterThan(0);
      expect(section.body.en.length).toBeGreaterThan(0);
    }
  });
});

describe("premiumServiceTemplate and corporateTemplate", () => {
  it("include every base section plus one additional section each", () => {
    const base = standardServiceTemplate.render(context);
    const premium = premiumServiceTemplate.render(context);
    const corporate = corporateTemplate.render(context);

    expect(premium.sections.length).toBe(base.sections.length + 1);
    expect(corporate.sections.length).toBe(base.sections.length + 1);
  });

  it("have distinct titles from the standard template", () => {
    const base = standardServiceTemplate.render(context);
    const premium = premiumServiceTemplate.render(context);
    const corporate = corporateTemplate.render(context);

    expect(premium.title.en).not.toBe(base.title.en);
    expect(corporate.title.en).not.toBe(base.title.en);
  });
});
