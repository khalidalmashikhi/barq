import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { VehicleFormFields } = await import("./vehicle-form-fields");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function walk(el: unknown, visit: (e: AnyEl) => void): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return el.forEach((c) => walk(c, visit));
  const e = el as AnyEl;
  visit(e);
  walk(e.props?.children, visit);
}
function fieldNames(el: unknown): string[] {
  const names: string[] = [];
  walk(el, (e) => {
    if ((e.type === "input" || e.type === "select" || e.type === "textarea") && typeof e.props?.name === "string") {
      names.push(e.props.name as string);
    }
  });
  return names;
}
function optionValues(el: unknown): string[] {
  const vals: string[] = [];
  walk(el, (e) => {
    if (e.type === "option" && typeof e.props?.value === "string" && e.props.value !== "") vals.push(e.props.value as string);
  });
  return vals;
}

describe("VehicleFormFields", () => {
  it("exposes exactly the VEHICLE-1-authorized fields", async () => {
    const names = fieldNames(await VehicleFormFields({}));
    expect(names.sort()).toEqual(
      ["color", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "registrationNumber", "vehicleType"].sort(),
    );
  });

  it("has NO providerId / assetType / status input (server-derived / immutable)", async () => {
    const names = fieldNames(await VehicleFormFields({}));
    expect(names).not.toContain("providerId");
    expect(names).not.toContain("assetType");
    expect(names).not.toContain("status");
  });

  it("the vehicle-type select submits the canonical codes (no competing vocabulary)", async () => {
    const values = optionValues(await VehicleFormFields({}));
    expect(values.sort()).toEqual(["FOUR_BY_FOUR", "MINIBUS", "OTHER", "SEDAN", "SUV", "VAN"].sort());
  });

  it("hydrates defaults for the edit form", async () => {
    let makeInput: AnyEl | null = null;
    walk(await VehicleFormFields({ defaults: { make: "Toyota", passengerCapacity: 6 } }), (e) => {
      if (e.type === "input" && e.props?.name === "make") makeInput = e;
    });
    expect(makeInput!.props.defaultValue).toBe("Toyota");
  });
});
