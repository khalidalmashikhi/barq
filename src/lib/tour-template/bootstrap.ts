import { TOUR_PACKAGE_DEFAULTS } from "./packages";
import { TOUR_VEHICLE_DEFAULTS } from "./vehicle-types";
import { TOUR_TEMPLATE_TEXT_DEFAULTS } from "./template-text";
import { TOUR_FIELD_RULE_DEFAULTS } from "./field-registry";

// Smart Tour-Guide Template — STAGING bootstrap core (config defaults).
//
// Pure, dependency-injected (Prisma passed in) so the same logic runs under `tsx`
// (scripts/bootstrap-staging-tour-template.ts) and under vitest with a mock
// client. Mirrors the ADR-0016 taxonomy / ADR-0017 verification bootstrap exactly:
//   - INSERT-IF-ABSENT by key/code — never overwrites an admin-edited existing row
//     (labels/flags an admin changed are preserved on re-run),
//   - never deletes a row, never touches any Service/Experience/Provider data,
//   - dry-run by default; writes only when options.apply is true,
//   - idempotent: re-running converges to "every canonical row exists".
//
// It seeds exactly the app-owned canonical presets/vehicle-types/text/field-rules
// (the SAME source as the fail-closed reader fallback), so a bootstrapped DB and
// an empty DB present identical defaults.

type Row = { id: string; key?: string; code?: string };

export interface TourTemplateBootstrapPrisma {
  tourPackagePreset: {
    findUnique(args: { where: { key: string } }): Promise<Row | null>;
    create(args: {
      data: { key: string; label: unknown; description: unknown; enabled: boolean; sortOrder: number };
    }): Promise<Row>;
  };
  tourVehicleTypeOption: {
    findUnique(args: { where: { code: string } }): Promise<Row | null>;
    create(args: { data: { code: string; label: unknown; enabled: boolean; sortOrder: number } }): Promise<Row>;
  };
  tourTemplateText: {
    findUnique(args: { where: { key: string } }): Promise<Row | null>;
    create(args: { data: { key: string; content: unknown; enabled: boolean; sortOrder: number } }): Promise<Row>;
  };
  tourTemplateFieldRule: {
    findUnique(args: { where: { key: string } }): Promise<Row | null>;
    create(args: {
      data: { key: string; visible: boolean; required: boolean; sortOrder: number };
    }): Promise<Row>;
  };
}

export type BootstrapAction = "created" | "exists";
export type BootstrapOutcome = { key: string; action: BootstrapAction };
export type TourTemplateBootstrapReport = {
  applied: boolean;
  packages: BootstrapOutcome[];
  vehicleTypes: BootstrapOutcome[];
  templateTexts: BootstrapOutcome[];
  fieldRules: BootstrapOutcome[];
};

export async function runTourTemplateBootstrap(
  prisma: TourTemplateBootstrapPrisma,
  options: { apply: boolean }
): Promise<TourTemplateBootstrapReport> {
  const { apply } = options;

  const packages: BootstrapOutcome[] = [];
  for (const def of TOUR_PACKAGE_DEFAULTS) {
    const existing = await prisma.tourPackagePreset.findUnique({ where: { key: def.key } });
    if (existing) {
      packages.push({ key: def.key, action: "exists" });
    } else {
      if (apply) {
        await prisma.tourPackagePreset.create({
          data: { key: def.key, label: def.label, description: def.description, enabled: true, sortOrder: def.sortOrder },
        });
      }
      packages.push({ key: def.key, action: "created" });
    }
  }

  const vehicleTypes: BootstrapOutcome[] = [];
  for (const def of TOUR_VEHICLE_DEFAULTS) {
    const existing = await prisma.tourVehicleTypeOption.findUnique({ where: { code: def.code } });
    if (existing) {
      vehicleTypes.push({ key: def.code, action: "exists" });
    } else {
      if (apply) {
        await prisma.tourVehicleTypeOption.create({
          data: { code: def.code, label: def.label, enabled: true, sortOrder: def.sortOrder },
        });
      }
      vehicleTypes.push({ key: def.code, action: "created" });
    }
  }

  const templateTexts: BootstrapOutcome[] = [];
  for (const def of TOUR_TEMPLATE_TEXT_DEFAULTS) {
    const existing = await prisma.tourTemplateText.findUnique({ where: { key: def.key } });
    if (existing) {
      templateTexts.push({ key: def.key, action: "exists" });
    } else {
      if (apply) {
        await prisma.tourTemplateText.create({
          data: { key: def.key, content: def.content, enabled: true, sortOrder: def.sortOrder },
        });
      }
      templateTexts.push({ key: def.key, action: "created" });
    }
  }

  const fieldRules: BootstrapOutcome[] = [];
  for (const def of TOUR_FIELD_RULE_DEFAULTS) {
    const existing = await prisma.tourTemplateFieldRule.findUnique({ where: { key: def.key } });
    if (existing) {
      fieldRules.push({ key: def.key, action: "exists" });
    } else {
      if (apply) {
        await prisma.tourTemplateFieldRule.create({
          data: { key: def.key, visible: def.visible, required: def.required, sortOrder: def.sortOrder },
        });
      }
      fieldRules.push({ key: def.key, action: "created" });
    }
  }

  return { applied: apply, packages, vehicleTypes, templateTexts, fieldRules };
}
