import { describe, it, expect, vi } from "vitest";
import { REGION_CODES } from "@/lib/regions";

// Core Service Enrichment, Gate 4 — RegionField form control. The mocked
// translator echoes the key, so an <option> label of "governorate.MUSCAT" proves
// the label came from i18n (not a hardcoded string) AND differs from the submitted
// value "MUSCAT" (the stable code) — the provider never types or sees a raw code.
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

const { RegionField } = await import("./region-field");

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

describe("RegionField", () => {
  it("renders all 11 governorate options plus an empty placeholder, submitting stable codes", async () => {
    const tree = await RegionField({ defaultValue: null });
    const options = optionsOf(tree);

    // 11 governorates + 1 placeholder.
    expect(options).toHaveLength(REGION_CODES.length + 1);

    const placeholder = options[0]!;
    expect(placeholder.props.value).toBe("");

    const codeOptions = options.slice(1);
    expect(codeOptions.map((o) => o.props.value)).toEqual([...REGION_CODES]);
    // Each visible label is the localized (mocked) key, never the raw code itself.
    for (const opt of codeOptions) {
      expect(opt.props.children).toBe(`governorate.${opt.props.value}`);
      expect(opt.props.children).not.toBe(opt.props.value);
    }
  });

  it("preselects the current governorate on an edit form", async () => {
    const tree = await RegionField({ defaultValue: "DHOFAR" });
    expect(selectOf(tree).props.defaultValue).toBe("DHOFAR");
  });

  it("stays unselected for null (a legacy service with no governorate)", async () => {
    const tree = await RegionField({ defaultValue: null });
    expect(selectOf(tree).props.defaultValue).toBe("");
  });

  it("falls back to unselected for an unknown/invalid preselect value (no phantom option)", async () => {
    const tree = await RegionField({ defaultValue: "Dhofar" });
    expect(selectOf(tree).props.defaultValue).toBe("");
  });

  it("names the field regionCode so the existing server action reads it", async () => {
    const tree = await RegionField({ defaultValue: null });
    expect(selectOf(tree).props.name).toBe("regionCode");
  });
});
