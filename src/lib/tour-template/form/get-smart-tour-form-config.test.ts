import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const packagesMock = vi.fn();
const vehiclesMock = vi.fn();
const fieldsMock = vi.fn();
const textMock = vi.fn();
vi.mock("../get-tour-template-config", () => ({
  getEnabledTourPackages: (...a: unknown[]) => packagesMock(...a),
  getEnabledTourVehicleTypes: (...a: unknown[]) => vehiclesMock(...a),
  getTourFieldRules: (...a: unknown[]) => fieldsMock(...a),
  getTourTemplateText: (...a: unknown[]) => textMock(...a),
}));

const { getSmartTourFormConfig } = await import("./get-smart-tour-form-config");

afterEach(() => {
  packagesMock.mockReset();
  vehiclesMock.mockReset();
  fieldsMock.mockReset();
  textMock.mockReset();
});

describe("getSmartTourFormConfig", () => {
  it("composes intro + packages + vehicle types + field rules for the locale", async () => {
    textMock.mockResolvedValue("Explore with a local guide");
    packagesMock.mockResolvedValue([{ key: "GUIDE_ONLY", label: "Guide only", description: "", includesTransport: false, requiresFourByFour: false }]);
    vehiclesMock.mockResolvedValue([{ code: "SUV", label: "SUV" }]);
    fieldsMock.mockResolvedValue([{ key: "maxGuests", visible: true, required: false, sortOrder: 0, label: null, helpText: null }]);

    const config = await getSmartTourFormConfig("en");

    expect(config.intro).toBe("Explore with a local guide");
    expect(config.packages.map((p) => p.key)).toEqual(["GUIDE_ONLY"]);
    expect(config.vehicleTypes.map((v) => v.code)).toEqual(["SUV"]);
    expect(config.fields.map((f) => f.key)).toEqual(["maxGuests"]);
    expect(textMock).toHaveBeenCalledWith("template.intro", "en");
  });

  it("works with app-default readers even when the DB is empty (no bootstrap required)", async () => {
    // Readers fall back to built-ins; here they still return the canonical sets.
    textMock.mockResolvedValue(null);
    packagesMock.mockResolvedValue([]);
    vehiclesMock.mockResolvedValue([]);
    fieldsMock.mockResolvedValue([]);

    const config = await getSmartTourFormConfig("ar");
    expect(config).toEqual({ intro: null, packages: [], vehicleTypes: [], fields: [] });
  });
});
