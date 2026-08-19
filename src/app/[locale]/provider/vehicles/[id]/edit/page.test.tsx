import { describe, it, expect, vi, afterEach } from "vitest";
import { VehicleFormFields } from "@/components/provider/vehicle-form-fields";

vi.mock("server-only", () => ({}));
const getProviderVehicleMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicle", () => ({ getProviderVehicle: (...a: unknown[]) => getProviderVehicleMock(...a) }));
vi.mock("@/lib/vehicles/update-vehicle", () => ({ updateVehicle: vi.fn() }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props, redirect: vi.fn() }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { default: EditVehiclePage } = await import("./page");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function find(el: unknown, pred: (e: AnyEl) => boolean): AnyEl | null {
  if (!el || typeof el !== "object") return null;
  if (Array.isArray(el)) {
    for (const c of el) {
      const r = find(c, pred);
      if (r) return r;
    }
    return null;
  }
  const e = el as AnyEl;
  if (pred(e)) return e;
  return find(e.props?.children, pred);
}

const vehicle = {
  id: "veh-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: null,
  registrationNumber: "OM 12345",
  status: "REGISTERED",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const props = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

afterEach(() => {
  getProviderVehicleMock.mockReset();
  notFoundMock.mockClear();
});

describe("EditVehiclePage", () => {
  it("hydrates the form with the caller's own vehicle values (VEHICLE-1 editable fields only)", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    const el = await EditVehiclePage(props("veh-1"));
    const fields = find(el, (e) => e.type === VehicleFormFields);
    expect(fields).not.toBeNull();
    const defaults = fields!.props.defaults as Record<string, unknown>;
    expect(defaults.make).toBe("Toyota");
    expect(defaults.registrationNumber).toBe("OM 12345");
    // Status/providerId/assetType are NOT part of the editable defaults.
    expect(defaults.status).toBeUndefined();
    expect(defaults.providerId).toBeUndefined();
    expect(defaults.assetType).toBeUndefined();
  });

  it("has a form but no status/providerId/assetType input (immutable via the edit form)", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    const el = await EditVehiclePage(props("veh-1"));
    const statusInput = find(el, (e) => (e.type === "input" || e.type === "select") && ["status", "providerId", "assetType"].includes(e.props?.name as string));
    expect(statusInput).toBeNull();
  });

  it("calls notFound() for a foreign/missing vehicle", async () => {
    getProviderVehicleMock.mockResolvedValue(null);
    await expect(EditVehiclePage(props("foreign"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
