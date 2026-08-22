import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => ({ type: "a", props: { href, children } }),
}));

const { VehiclePoolSection } = await import("./vehicle-pool-section");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function walk(el: unknown, visit: (e: AnyEl) => void): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return el.forEach((c) => walk(c, visit));
  const e = el as AnyEl;
  visit(e);
  walk(e.props?.children, visit);
}

const noop = () => {};

function collect(tree: unknown, addAction: () => void, removeAction: () => void) {
  const addVehicleIds: string[] = [];
  const removeVehicleIds: string[] = [];
  const texts: string[] = [];
  const hrefs: string[] = [];
  let currentFormKind: "add" | "remove" | null = null;
  walk(tree, (e) => {
    if (e.type === "form") currentFormKind = e.props.action === addAction ? "add" : e.props.action === removeAction ? "remove" : null;
    if (e.type === "input" && e.props?.name === "vehicleId" && typeof e.props?.value === "string") {
      if (currentFormKind === "add") addVehicleIds.push(e.props.value as string);
      else if (currentFormKind === "remove") removeVehicleIds.push(e.props.value as string);
    }
    if (typeof e.props?.children === "string") texts.push(e.props.children as string);
    if (typeof e.props?.href === "string") hrefs.push(e.props.href as string);
  });
  return { addVehicleIds, removeVehicleIds, texts, hrefs };
}

function vv(over: Partial<Record<string, unknown>> = {}) {
  return {
    vehicleId: "veh-1",
    make: "Toyota",
    model: "Hilux",
    modelYear: 2025,
    color: "White",
    vehicleType: "SUV",
    passengerCapacity: 6,
    isFourByFour: false,
    eligible: true,
    blockers: [],
    isInPool: false,
    ...over,
  };
}

describe("VehiclePoolSection", () => {
  it("GUIDE_ONLY: shows the no-vehicle note and renders NO add/remove forms", async () => {
    const view = { packageType: "GUIDE_ONLY", vehicleAllowed: false, requiresFourByFour: false, maxGuests: null, pool: [], available: [] };
    const tree = await VehiclePoolSection({ view: view as never, addAction: noop, removeAction: noop });
    const { addVehicleIds, removeVehicleIds, texts } = collect(tree, noop, noop);
    expect(texts).toContain("tourVehiclePoolGuideOnlyNote");
    expect(addVehicleIds).toEqual([]);
    expect(removeVehicleIds).toEqual([]);
  });

  it("transport: multi-vehicle — remove for each pooled, add for each eligible candidate; ineligible pooled shows blockers", async () => {
    const addAction = vi.fn();
    const removeAction = vi.fn();
    const view = {
      packageType: "GUIDE_WITH_TRANSPORT",
      vehicleAllowed: true,
      requiresFourByFour: false,
      maxGuests: null,
      pool: [
        vv({ vehicleId: "veh-1", isInPool: true, eligible: true }),
        vv({ vehicleId: "veh-2", isInPool: true, eligible: false, blockers: ["NOT_ACTIVE"] }),
      ],
      available: [vv({ vehicleId: "veh-3", eligible: true })],
    };
    const tree = await VehiclePoolSection({ view: view as never, addAction, removeAction });
    const { addVehicleIds, removeVehicleIds, texts } = collect(tree, addAction, removeAction);

    // Pool is a MULTI list — a remove form per pooled vehicle.
    expect(removeVehicleIds.sort()).toEqual(["veh-1", "veh-2"]);
    // Each eligible candidate gets an add form.
    expect(addVehicleIds).toEqual(["veh-3"]);
    // The ineligible pooled vehicle surfaces its blocker + "currently unavailable".
    expect(texts).toContain("tourVehiclePoolBlockerNotActive");
    expect(texts).toContain("tourVehiclePoolUnavailableBadge");
    // No plate/registration ever reaches the selector (slim DTO has none).
    expect(JSON.stringify(tree)).not.toContain("registrationNumber");
  });

  it("GUIDE_WITH_4X4: an ineligible non-pooled candidate is shown read-only with its 4x4 blocker, no add form", async () => {
    const addAction = vi.fn();
    const removeAction = vi.fn();
    const view = {
      packageType: "GUIDE_WITH_4X4",
      vehicleAllowed: true,
      requiresFourByFour: true,
      maxGuests: null,
      pool: [],
      available: [vv({ vehicleId: "veh-4", eligible: false, blockers: ["NOT_FOUR_BY_FOUR_CAPABLE"] })],
    };
    const tree = await VehiclePoolSection({ view: view as never, addAction, removeAction });
    const { addVehicleIds, texts } = collect(tree, addAction, removeAction);
    expect(addVehicleIds).toEqual([]); // not eligible → cannot be added
    expect(texts).toContain("tourVehiclePoolBlockerNot4x4");
    expect(texts).toContain("tourVehiclePoolNotEligibleTitle");
  });

  it("empty state: no pool + no candidates shows the empty message and the My Vehicles CTA", async () => {
    const view = { packageType: "GUIDE_WITH_TRANSPORT", vehicleAllowed: true, requiresFourByFour: false, maxGuests: null, pool: [], available: [] };
    const tree = await VehiclePoolSection({ view: view as never, addAction: noop, removeAction: noop });
    const { texts, hrefs } = collect(tree, noop, noop);
    expect(texts).toContain("tourVehiclePoolNoVehiclesEmptyState");
    expect(hrefs).toContain("/provider/vehicles");
  });
});
