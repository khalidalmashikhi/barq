import { describe, it, expect, vi } from "vitest";
import { BOOKABLE_PRICING_UNIT_CODES } from "@/lib/pricing-units/billability";

// Core Service Enrichment, Gate 4 — PricingUnitField form control. Mirrors the
// RegionField test: options submit the stable unit code while displaying a
// localized (mocked-as-key) label, so a raw code is never the user-facing label.
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

const { PricingUnitField } = await import("./pricing-unit-field");

type AnyElement = { type: unknown; props: Record<string, unknown> };

function collect(element: unknown, predicate: (el: AnyElement) => boolean, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collect(child, predicate, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) collect(el.props.children, predicate, acc);
  return acc;
}

function optionsOf(tree: unknown): AnyElement[] {
  return collect(tree, (el) => el.type === "option");
}
function selectOf(tree: unknown): AnyElement {
  return collect(tree, (el) => el.type === "select")[0]!;
}

describe("PricingUnitField", () => {
  it("renders ONLY the bookable unit options plus an empty placeholder, submitting stable codes", async () => {
    const tree = await PricingUnitField({ defaultValue: null });
    const options = optionsOf(tree);

    expect(options).toHaveLength(BOOKABLE_PRICING_UNIT_CODES.length + 1);
    expect(options[0]!.props.value).toBe("");

    const codeOptions = options.slice(1);
    // The reserved duration units (PER_DAY/PER_HOUR) are NOT offered for a new active price.
    expect(codeOptions.map((o) => o.props.value)).toEqual([...BOOKABLE_PRICING_UNIT_CODES]);
    expect(codeOptions.map((o) => o.props.value)).not.toContain("PER_DAY");
    for (const opt of codeOptions) {
      expect(opt.props.children).toBe(`pricingUnit.${opt.props.value}`);
      expect(opt.props.children).not.toBe(opt.props.value);
    }
  });

  it("is required (with the empty placeholder) so a unit must be explicitly chosen", async () => {
    expect(selectOf(await PricingUnitField({ defaultValue: null })).props.required).toBe(true);
  });

  it("preselects the current bookable unit on an edit form", async () => {
    const tree = await PricingUnitField({ defaultValue: "PER_VEHICLE" });
    expect(selectOf(tree).props.defaultValue).toBe("PER_VEHICLE");
  });

  it("stays unselected for null (a price with no unit)", async () => {
    const tree = await PricingUnitField({ defaultValue: null });
    expect(selectOf(tree).props.defaultValue).toBe("");
  });

  it("falls back to unselected for an unknown/invalid preselect value", async () => {
    const tree = await PricingUnitField({ defaultValue: "PER_NIGHT" });
    expect(selectOf(tree).props.defaultValue).toBe("");
  });

  it("names the field pricingUnit so the existing server action reads it", async () => {
    const tree = await PricingUnitField({ defaultValue: null });
    expect(selectOf(tree).props.name).toBe("pricingUnit");
  });
});
