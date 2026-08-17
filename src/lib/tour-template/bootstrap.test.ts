import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTourTemplateBootstrap, type TourTemplateBootstrapPrisma } from "./bootstrap";
import { TOUR_PACKAGE_DEFAULTS } from "./packages";
import { TOUR_VEHICLE_DEFAULTS } from "./vehicle-types";
import { TOUR_TEMPLATE_TEXT_DEFAULTS } from "./template-text";
import { TOUR_FIELD_RULE_DEFAULTS } from "./field-registry";

// Idempotent insert-if-absent bootstrap: creates missing canonical rows only when
// applied, never overwrites an existing (possibly admin-edited) row, and re-runs
// converge to "everything exists".

type Store = { keys: Set<string> };

function makePrisma(existing: { presets?: string[]; vehicles?: string[]; texts?: string[]; fields?: string[] } = {}) {
  const created = { preset: [] as string[], vehicle: [] as string[], text: [] as string[], field: [] as string[] };
  const presets: Store = { keys: new Set(existing.presets ?? []) };
  const vehicles: Store = { keys: new Set(existing.vehicles ?? []) };
  const texts: Store = { keys: new Set(existing.texts ?? []) };
  const fields: Store = { keys: new Set(existing.fields ?? []) };

  const prisma: TourTemplateBootstrapPrisma = {
    tourPackagePreset: {
      findUnique: async ({ where: { key } }) => (presets.keys.has(key) ? { id: "x", key } : null),
      create: async ({ data }) => {
        created.preset.push(data.key);
        presets.keys.add(data.key);
        return { id: "new", key: data.key };
      },
    },
    tourVehicleTypeOption: {
      findUnique: async ({ where: { code } }) => (vehicles.keys.has(code) ? { id: "x", code } : null),
      create: async ({ data }) => {
        created.vehicle.push(data.code);
        vehicles.keys.add(data.code);
        return { id: "new", code: data.code };
      },
    },
    tourTemplateText: {
      findUnique: async ({ where: { key } }) => (texts.keys.has(key) ? { id: "x", key } : null),
      create: async ({ data }) => {
        created.text.push(data.key);
        texts.keys.add(data.key);
        return { id: "new", key: data.key };
      },
    },
    tourTemplateFieldRule: {
      findUnique: async ({ where: { key } }) => (fields.keys.has(key) ? { id: "x", key } : null),
      create: async ({ data }) => {
        created.field.push(data.key);
        fields.keys.add(data.key);
        return { id: "new", key: data.key };
      },
    },
  };
  return { prisma, created };
}

beforeEach(() => vi.clearAllMocks());

describe("runTourTemplateBootstrap", () => {
  it("dry-run creates NOTHING and reports every canonical row as would-create", async () => {
    const { prisma, created } = makePrisma();
    const report = await runTourTemplateBootstrap(prisma, { apply: false });
    expect(report.applied).toBe(false);
    expect(created.preset).toHaveLength(0);
    expect(created.vehicle).toHaveLength(0);
    expect(report.packages).toHaveLength(TOUR_PACKAGE_DEFAULTS.length);
    expect(report.packages.every((p) => p.action === "created")).toBe(true);
  });

  it("apply creates exactly the canonical rows when the DB is empty", async () => {
    const { prisma, created } = makePrisma();
    const report = await runTourTemplateBootstrap(prisma, { apply: true });
    expect(report.applied).toBe(true);
    expect(created.preset.sort()).toEqual(TOUR_PACKAGE_DEFAULTS.map((d) => d.key).sort());
    expect(created.vehicle.sort()).toEqual(TOUR_VEHICLE_DEFAULTS.map((d) => d.code).sort());
    expect(created.text.sort()).toEqual(TOUR_TEMPLATE_TEXT_DEFAULTS.map((d) => d.key).sort());
    expect(created.field.sort()).toEqual(TOUR_FIELD_RULE_DEFAULTS.map((d) => d.key).sort());
  });

  it("is idempotent: an already-present row is left as-is (never overwritten)", async () => {
    const { prisma, created } = makePrisma({
      presets: ["GUIDE_ONLY"],
      vehicles: ["FOUR_BY_FOUR"],
      texts: ["template.intro"],
      fields: ["maxGuests"],
    });
    const report = await runTourTemplateBootstrap(prisma, { apply: true });
    // existing rows are NOT re-created
    expect(created.preset).not.toContain("GUIDE_ONLY");
    expect(created.vehicle).not.toContain("FOUR_BY_FOUR");
    expect(created.text).not.toContain("template.intro");
    expect(created.field).not.toContain("maxGuests");
    // and they report as "exists"
    expect(report.packages.find((p) => p.key === "GUIDE_ONLY")!.action).toBe("exists");
    // a second run creates nothing at all
    const { prisma: prisma2, created: created2 } = makePrisma({
      presets: TOUR_PACKAGE_DEFAULTS.map((d) => d.key),
      vehicles: TOUR_VEHICLE_DEFAULTS.map((d) => d.code),
      texts: TOUR_TEMPLATE_TEXT_DEFAULTS.map((d) => d.key),
      fields: TOUR_FIELD_RULE_DEFAULTS.map((d) => d.key),
    });
    await runTourTemplateBootstrap(prisma2, { apply: true });
    expect(created2.preset).toHaveLength(0);
    expect(created2.vehicle).toHaveLength(0);
    expect(created2.text).toHaveLength(0);
    expect(created2.field).toHaveLength(0);
  });
});
