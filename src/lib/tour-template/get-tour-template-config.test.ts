import { describe, it, expect, vi, afterEach } from "vitest";

// Fail-closed config readers: enabled + stable order, admin overlay, localization
// fallback (requested -> en -> app default), and unknown DB keys ignored.

vi.mock("server-only", () => ({}));

const packageFindMany = vi.fn();
const vehicleFindMany = vi.fn();
const textFindUnique = vi.fn();
const fieldRuleFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    tourPackagePreset: { findMany: (...a: unknown[]) => packageFindMany(...a) },
    tourVehicleTypeOption: { findMany: (...a: unknown[]) => vehicleFindMany(...a) },
    tourTemplateText: { findUnique: (...a: unknown[]) => textFindUnique(...a) },
    tourTemplateFieldRule: { findMany: (...a: unknown[]) => fieldRuleFindMany(...a) },
  },
}));

const {
  getEnabledTourPackages,
  getEnabledTourVehicleTypes,
  getTourTemplateText,
  getTourFieldRules,
} = await import("./get-tour-template-config");

afterEach(() => {
  packageFindMany.mockReset();
  vehicleFindMany.mockReset();
  textFindUnique.mockReset();
  fieldRuleFindMany.mockReset();
});

describe("getEnabledTourPackages", () => {
  it("returns all canonical packages (enabled) in default order when the DB is empty", async () => {
    packageFindMany.mockResolvedValue([]);
    const packages = await getEnabledTourPackages("en");
    expect(packages.map((p) => p.key)).toEqual([
      "GUIDE_ONLY",
      "GUIDE_WITH_TRANSPORT",
      "GUIDE_WITH_4X4",
      "PRIVATE_CUSTOM_TOUR",
    ]);
    // semantics always come from code
    expect(packages.find((p) => p.key === "GUIDE_WITH_4X4")).toMatchObject({ includesTransport: true, requiresFourByFour: true });
    expect(packages.find((p) => p.key === "GUIDE_ONLY")).toMatchObject({ includesTransport: false, requiresFourByFour: false });
  });

  it("does NOT return a disabled package and honors admin sortOrder + label overrides", async () => {
    packageFindMany.mockResolvedValue([
      { key: "GUIDE_ONLY", label: { en: "Guide only (edited)" }, description: { en: "d" }, enabled: false, sortOrder: 0 },
      { key: "PRIVATE_CUSTOM_TOUR", label: { en: "Custom" }, description: { en: "d" }, enabled: true, sortOrder: -1 },
    ]);
    const packages = await getEnabledTourPackages("en");
    expect(packages.map((p) => p.key)).not.toContain("GUIDE_ONLY"); // disabled
    expect(packages[0]?.key).toBe("PRIVATE_CUSTOM_TOUR"); // sortOrder -1 floats to front
  });

  it("ignores a DB row whose key is unknown (fail-closed, never rendered)", async () => {
    packageFindMany.mockResolvedValue([{ key: "HELICOPTER_TOUR", label: { en: "Heli" }, description: null, enabled: true, sortOrder: 0 }]);
    const packages = await getEnabledTourPackages("en");
    expect(packages.map((p) => p.key)).not.toContain("HELICOPTER_TOUR");
    expect(packages).toHaveLength(4); // exactly the canonical set
  });

  it("localization falls back requested -> en -> built-in default", async () => {
    packageFindMany.mockResolvedValue([
      { key: "GUIDE_ONLY", label: { en: "Only EN" }, description: { en: "d" }, enabled: true, sortOrder: 0 },
    ]);
    // de not present on the admin row -> falls back to en
    const de = await getEnabledTourPackages("de");
    expect(de.find((p) => p.key === "GUIDE_ONLY")!.label).toBe("Only EN");
    // ar not present on the admin row -> also falls back to en (admin only typed en)
    const ar = await getEnabledTourPackages("ar");
    expect(ar.find((p) => p.key === "GUIDE_ONLY")!.label).toBe("Only EN");
  });

  it("uses the built-in Arabic default when no DB row exists", async () => {
    packageFindMany.mockResolvedValue([]);
    const ar = await getEnabledTourPackages("ar");
    expect(ar.find((p) => p.key === "GUIDE_ONLY")!.label).toBe("جولة مع مرشد سياحي");
  });
});

describe("getEnabledTourVehicleTypes", () => {
  it("returns canonical codes in order when DB empty; drops disabled + unknown", async () => {
    vehicleFindMany.mockResolvedValue([
      { code: "SEDAN", label: { en: "Sedan" }, enabled: false, sortOrder: 0 },
      { code: "SPACESHIP", label: { en: "Spaceship" }, enabled: true, sortOrder: 0 },
    ]);
    const options = await getEnabledTourVehicleTypes("en");
    expect(options.map((o) => o.code)).not.toContain("SEDAN"); // disabled
    expect(options.map((o) => o.code)).not.toContain("SPACESHIP"); // unknown
    expect(options.map((o) => o.code)).toContain("FOUR_BY_FOUR");
  });
});

describe("getTourTemplateText", () => {
  it("returns the localized admin value when the row is enabled", async () => {
    textFindUnique.mockResolvedValue({ content: { en: "Admin intro", ar: "مقدمة" }, enabled: true });
    expect(await getTourTemplateText("template.intro", "ar")).toBe("مقدمة");
    expect(await getTourTemplateText("template.intro", "en")).toBe("Admin intro");
  });

  it("falls back to the built-in default when the row is absent or disabled", async () => {
    textFindUnique.mockResolvedValue(null);
    expect(await getTourTemplateText("template.intro", "en")).toContain("Explore the destination");
    textFindUnique.mockResolvedValue({ content: { en: "hidden" }, enabled: false });
    expect(await getTourTemplateText("template.intro", "en")).toContain("Explore the destination");
  });

  it("returns null for an unknown text key (never queried into existence)", async () => {
    expect(await getTourTemplateText("template.unknown", "en")).toBeNull();
    expect(textFindUnique).not.toHaveBeenCalled();
  });
});

describe("getTourFieldRules", () => {
  it("ignores unknown DB keys and overlays known ones", async () => {
    fieldRuleFindMany.mockResolvedValue([
      { key: "maxGuests", visible: true, required: true, sortOrder: 0, label: null, helpText: null },
      { key: "totallyMadeUp", visible: true, required: true, sortOrder: 0, label: null, helpText: null },
    ]);
    const rules = await getTourFieldRules("en");
    expect(rules.map((r) => r.key)).not.toContain("totallyMadeUp");
    expect(rules.find((r) => r.key === "maxGuests")).toMatchObject({ required: true });
    // untouched keys keep their default (required: false)
    expect(rules.find((r) => r.key === "meetingPoint")).toMatchObject({ required: false, visible: true });
  });
});
