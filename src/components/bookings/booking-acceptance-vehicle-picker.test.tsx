import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { BookingAcceptanceVehiclePicker } = await import("./booking-acceptance-vehicle-picker");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function walk(el: unknown, visit: (e: AnyEl) => void): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return el.forEach((c) => walk(c, visit));
  const e = el as AnyEl;
  visit(e);
  walk(e.props?.children, visit);
}
function texts(tree: unknown): string[] {
  const out: string[] = [];
  walk(tree, (e) => {
    if (typeof e.props?.children === "string") out.push(e.props.children as string);
  });
  return out;
}
function radios(tree: unknown): AnyEl[] {
  const out: AnyEl[] = [];
  walk(tree, (e) => {
    if (e.type === "input" && e.props?.type === "radio") out.push(e);
  });
  return out;
}

const V = (over: Record<string, unknown> = {}) => ({
  vehicleId: "veh-1", make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
  vehicleType: "SUV", passengerCapacity: 6, isFourByFour: false, eligible: true, blockers: [],
  ...over,
});

describe("BookingAcceptanceVehiclePicker (provider)", () => {
  it("required + exactly one eligible vehicle → one radio, pre-selected; no private data", async () => {
    const options = { vehicleRequired: true, requiresFourByFour: false, seats: 4, candidates: [V()] };
    const tree = await BookingAcceptanceVehiclePicker({ options: options as never });
    const t = texts(tree);
    expect(t).toContain("acceptVehicleSelectHeading");
    expect(t).toContain("acceptVehicleRequiredHint");
    expect(t).toContain("Toyota Prado");
    const rs = radios(tree);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.props.value).toBe("veh-1");
    expect(rs[0]!.props.defaultChecked).toBe(true); // sole eligible + required → pre-selected
    expect(JSON.stringify(tree)).not.toContain("registrationNumber");
  });

  it("multiple eligible vehicles → a radio each, none pre-selected", async () => {
    const options = {
      vehicleRequired: true, requiresFourByFour: false, seats: 4,
      candidates: [V({ vehicleId: "a" }), V({ vehicleId: "b", model: "Patrol" })],
    };
    const rs = radios(await BookingAcceptanceVehiclePicker({ options: options as never }));
    expect(rs.map((r) => r.props.value)).toEqual(["a", "b"]);
    expect(rs.every((r) => r.props.defaultChecked === false)).toBe(true);
  });

  it("ineligible pooled vehicle → shown read-only with its blocker reason, not a radio", async () => {
    const options = {
      vehicleRequired: true, requiresFourByFour: false, seats: 4,
      candidates: [V({ eligible: false, blockers: ["NOT_ACTIVE"] })],
    };
    const tree = await BookingAcceptanceVehiclePicker({ options: options as never });
    expect(radios(tree)).toHaveLength(0);
    const t = texts(tree);
    expect(t).toContain("tourVehiclePoolBlockerNotActive"); // reused pool blocker copy
    expect(t).toContain("tourVehiclePoolUnavailableBadge");
    expect(t).toContain("acceptVehicleNoneEligible"); // required + none eligible → notice
  });

  it("4x4 eligible vehicle → 4x4 badge chip", async () => {
    const options = { vehicleRequired: true, requiresFourByFour: true, seats: 2, candidates: [V({ isFourByFour: true })] };
    expect(texts(await BookingAcceptanceVehiclePicker({ options: options as never }))).toContain("tourVehiclePool4x4Badge");
  });
});
