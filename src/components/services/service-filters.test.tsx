import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import Link from "next/link";

// Phase D.2 — regression test for a real, live i18n defect fixed this
// phase: ServiceFilters (rendered on the public /services marketplace,
// every locale) previously hardcoded every string in Arabic, never
// routing through next-intl. This test doesn't assert real translated
// content (messages/*.json content isn't this test's concern) — it
// asserts the search input's placeholder came FROM the translator
// (mocked here as an identity function returning the key), not a
// literal hardcoded string, which is exactly the shape of bug that
// existed before this phase's fix.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

// Phase F.2 — ServiceFilters now also resolves the active-filters
// "clear" links via getLocale()/getPathname(), neither of which can run
// outside a real Next.js request (getPathname in particular pulls in
// next-intl's navigation factory, which fails to resolve entirely
// under Vitest — verified directly, not assumed). Mocked here with
// simple stand-ins; this test's own concern (the search placeholder
// comes from the translator, not a hardcoded string) doesn't depend on
// either being real.
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: () => "/services",
}));

const { ServiceFilters } = await import("./service-filters");

function findFirstInput(element: unknown): { props: { placeholder?: string; name?: string } } | undefined {
  if (!element || typeof element !== "object") return undefined;
  const el = element as ReactElement<{ children?: unknown; name?: string; placeholder?: string }>;
  if (el.props && "name" in el.props && el.props.name === "q") {
    return el as unknown as { props: { placeholder?: string; name?: string } };
  }
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findFirstInput(child);
      if (found) return found;
    }
  } else if (children) {
    return findFirstInput(children);
  }
  return undefined;
}

describe("ServiceFilters i18n", () => {
  it("resolves the search input's placeholder through the translator, not a hardcoded string", async () => {
    const element = await ServiceFilters({ providers: [] });
    const input = findFirstInput(element);
    expect(input).toBeDefined();
    // The mocked translator echoes the key itself — proves the value
    // came from t("searchPlaceholder"), not a literal Arabic string.
    expect(input!.props.placeholder).toBe("searchPlaceholder");
  });
});

// UX remediation (category navigation fix) — regression tests proving
// the category filter is (1) visible as a removable chip, (2) preserved
// across other-filter submissions via a hidden input, and (3) that no
// nested <Link> was introduced by adding the chip (a real, known way to
// silently break this file's existing chip-row <Link> pattern and
// produce a nested <a> once next/link renders to real DOM).

type AnyElement = { type: unknown; props: Record<string, unknown> };

// `.map()`-produced children (e.g. the chip list) arrive as a nested
// array literal inside a parent's props.children, not auto-flattened —
// so every walker here must recurse into arrays at ANY depth, not just
// the immediate props.children of an element.
function collectByPredicate(element: unknown, predicate: (el: AnyElement) => boolean, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectByPredicate(child, predicate, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) collectByPredicate(el.props.children, predicate, acc);
  return acc;
}

function collectLinks(element: unknown): AnyElement[] {
  return collectByPredicate(element, (el) => el.type === Link);
}

function collectInputs(element: unknown): AnyElement[] {
  return collectByPredicate(element, (el) => el.type === "input");
}

function collectOptions(element: unknown): AnyElement[] {
  return collectByPredicate(element, (el) => el.type === "option");
}

function findRegionSelect(element: unknown): AnyElement | undefined {
  return collectByPredicate(element, (el) => el.type === "select" && el.props.name === "region")[0];
}

describe("ServiceFilters — category filter", () => {
  it("renders a category chip labeled via chipCategoryLabel when currentCategory/currentCategoryLabel are set", async () => {
    const element = await ServiceFilters({
      providers: [],
      currentCategory: "transport",
      currentCategoryLabel: "Transport",
    });

    const links = collectLinks(element);
    const chipTexts = links.map((link) => JSON.stringify(link.props.children));
    expect(chipTexts.some((text) => text.includes("chipCategoryLabel"))).toBe(true);
  });

  it("includes a hidden input named 'category' preserving the value across form submission", async () => {
    const element = await ServiceFilters({
      providers: [],
      currentCategory: "transport",
      currentCategoryLabel: "Transport",
    });

    const inputs = collectInputs(element);
    const hiddenCategoryInput = inputs.find((input) => input.props.name === "category");
    expect(hiddenCategoryInput).toBeDefined();
    expect(hiddenCategoryInput?.props.type).toBe("hidden");
    expect(hiddenCategoryInput?.props.value).toBe("transport");
  });

  it("omits the hidden category input entirely when no category is active", async () => {
    const element = await ServiceFilters({ providers: [] });
    const inputs = collectInputs(element);
    expect(inputs.some((input) => input.props.name === "category")).toBe(false);
  });

  it("never nests a <Link> element inside another <Link> element", async () => {
    const element = await ServiceFilters({
      providers: [],
      currentCategory: "transport",
      currentCategoryLabel: "Transport",
      currentSearch: "sunset",
    });

    function hasNestedLink(node: unknown, insideLink = false): boolean {
      if (!node || typeof node !== "object") return false;
      if (Array.isArray(node)) {
        return node.some((child) => hasNestedLink(child, insideLink));
      }
      const el = node as AnyElement;
      const isLink = el.type === Link;
      if (isLink && insideLink) return true;
      if (el.props?.children === undefined) return false;
      return hasNestedLink(el.props.children, insideLink || isLink);
    }

    expect(hasNestedLink(element)).toBe(false);
  });
});

// Core Service Enrichment, Gate 4 — the governorate discovery filter. A native
// GET-form <select name="region"> submitting stable codes, plus a removable chip.
describe("ServiceFilters — governorate filter", () => {
  it("renders a region <select> with all 11 governorate codes as option values plus a placeholder", async () => {
    const element = await ServiceFilters({ providers: [] });
    const select = findRegionSelect(element);
    expect(select).toBeDefined();

    // Options that belong to the region select: placeholder ("") + 11 codes.
    const regionOptionValues = collectOptions(select).map((o) => o.props.value);
    expect(regionOptionValues).toEqual([
      "",
      "MUSCAT",
      "DHOFAR",
      "MUSANDAM",
      "AL_BURAIMI",
      "AD_DAKHILIYAH",
      "AL_BATINAH_NORTH",
      "AL_BATINAH_SOUTH",
      "ASH_SHARQIYAH_NORTH",
      "ASH_SHARQIYAH_SOUTH",
      "ADH_DHAHIRAH",
      "AL_WUSTA",
    ]);
  });

  it("preselects the active governorate code in the select", async () => {
    const element = await ServiceFilters({ providers: [], currentRegion: "DHOFAR" });
    expect(findRegionSelect(element)?.props.defaultValue).toBe("DHOFAR");
  });

  it("stays unselected when no region is active", async () => {
    const element = await ServiceFilters({ providers: [] });
    expect(findRegionSelect(element)?.props.defaultValue).toBe("");
  });

  it("renders a removable region chip (localized label) when a valid governorate is active", async () => {
    const element = await ServiceFilters({ providers: [], currentRegion: "DHOFAR" });
    const chipTexts = collectLinks(element).map((link) => JSON.stringify(link.props.children));
    // The mocked translator echoes the label key.
    expect(chipTexts.some((text) => text.includes("governorate.DHOFAR"))).toBe(true);
  });

  it("shows no region chip for an invalid/unknown region value (fails safe)", async () => {
    const element = await ServiceFilters({ providers: [], currentRegion: "NOT_A_REGION" });
    const chipTexts = collectLinks(element).map((link) => JSON.stringify(link.props.children));
    expect(chipTexts.some((text) => text.includes("NOT_A_REGION"))).toBe(false);
  });
});
