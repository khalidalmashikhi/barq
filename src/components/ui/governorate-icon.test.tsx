import { describe, it, expect } from "vitest";
import { Building2, MapPin } from "lucide-react";
import { GOVERNORATE_ICONS, GovernorateIcon } from "./governorate-icon";
import { REGION_CODES } from "@/lib/regions";

// UNIFIED GOVERNORATE ICON SYSTEM (UI polish) — the mapping must cover every canonical
// governorate, every value must be a real (lucide) icon component, and an unknown/empty code
// must fall back safely without crashing. Purely presentational; no geography logic here.

describe("GOVERNORATE_ICONS mapping", () => {
  it("covers EVERY canonical region code exactly", () => {
    const mapped = Object.keys(GOVERNORATE_ICONS).sort();
    const canonical = [...REGION_CODES].sort();
    expect(mapped).toEqual(canonical);
  });

  it("maps every code to a real icon component (a renderable lucide component)", () => {
    for (const code of REGION_CODES) {
      const Icon = GOVERNORATE_ICONS[code];
      expect(Icon, code).toBeDefined();
      // lucide icons are forwardRef components (typeof "object"); some builds expose plain
      // functions — accept either, just never a string/number/undefined.
      expect(["function", "object"].includes(typeof Icon), code).toBe(true);
    }
  });
});

describe("GovernorateIcon", () => {
  it("renders the mapped icon for a known code", () => {
    const el = GovernorateIcon({ code: "MUSCAT" });
    expect(el.type).toBe(Building2);
    expect(el.type).toBe(GOVERNORATE_ICONS.MUSCAT);
  });

  it("falls back to a neutral MapPin for an unknown code (never throws)", () => {
    expect(() => GovernorateIcon({ code: "ATLANTIS" })).not.toThrow();
    expect(GovernorateIcon({ code: "ATLANTIS" }).type).toBe(MapPin);
  });

  it("falls back for an empty code without crashing", () => {
    expect(GovernorateIcon({ code: "" }).type).toBe(MapPin);
  });

  it("passes size/strokeWidth through and marks the icon aria-hidden (name stays authoritative)", () => {
    const el = GovernorateIcon({ code: "DHOFAR", size: 14, strokeWidth: 1.75 });
    expect(el.props.size).toBe(14);
    expect(el.props.strokeWidth).toBe(1.75);
    expect(el.props["aria-hidden"]).toBe(true);
  });
});
