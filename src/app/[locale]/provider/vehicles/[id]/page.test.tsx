import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const getProviderVehicleMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicle", () => ({ getProviderVehicle: (...a: unknown[]) => getProviderVehicleMock(...a) }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { default: VehicleDetailPage } = await import("./page");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function collectHrefs(el: unknown, acc: string[] = []): string[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => collectHrefs(c, acc)), acc;
  const e = el as AnyEl;
  if (typeof e.props?.href === "string") acc.push(e.props.href as string);
  collectHrefs(e.props?.children, acc);
  return acc;
}
function allStrings(el: unknown, acc: string[] = []): string[] {
  if (typeof el === "string") return acc.push(el), acc;
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => allStrings(c, acc)), acc;
  for (const v of Object.values((el as AnyEl).props ?? {})) allStrings(v, acc);
  return acc;
}

const vehicle = {
  id: "veh-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: "Desert-ready.",
  registrationNumber: "OM 12345",
  status: "REGISTERED",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => {
  getProviderVehicleMock.mockReset();
  notFoundMock.mockClear();
});

describe("VehicleDetailPage", () => {
  it("renders the private vehicle fields and an Edit link", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    const el = await VehicleDetailPage(params("veh-1"));
    const strings = allStrings(el);
    expect(strings).toContain("Toyota Land Cruiser");
    expect(strings).toContain("OM 12345"); // private reg shown to owner
    expect(strings).toContain("Desert-ready.");
    expect(collectHrefs(el)).toContain("/provider/vehicles/veh-1/edit");
  });

  it("has NO lifecycle controls (activate/verify/deactivate/maintenance/delete) and no form", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    const el = await VehicleDetailPage(params("veh-1"));
    // No mutation controls: no <form>, and no action-shaped labels leaked.
    let hasForm = false;
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const e = n as AnyEl;
      if (e.type === "form" || e.type === "button") hasForm = true;
      walk(e.props?.children);
    };
    walk(el);
    expect(hasForm).toBe(false);
    const joined = allStrings(el).join(" ").toLowerCase();
    for (const forbidden of ["activate", "deactivate", "verify", "maintenance", "delete"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("calls notFound() for a foreign/missing vehicle (never enumerable)", async () => {
    getProviderVehicleMock.mockResolvedValue(null);
    await expect(VehicleDetailPage(params("foreign"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
