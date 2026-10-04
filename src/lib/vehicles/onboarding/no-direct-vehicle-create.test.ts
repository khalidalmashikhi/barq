import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// STRUCTURAL guard (Phase 3C Slice 3B): a new vehicle can only come from the document-first
// onboarding flow. No page, server action or API route may reach the direct-create primitive, and
// vehicle registration must stay independent of the rental workspace and of every vertical.

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
}
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
// Strip line comments so documentation that NAMES a forbidden symbol does not trip the guard.
const code = (rel: string) => read(rel).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("no direct vehicle-create path remains reachable", () => {
  it("nothing under src/app imports or calls the direct-create primitive", () => {
    const offenders = sourceFiles(path.join(SRC, "app"))
      .map((f) => "app/" + f)
      .filter((rel) => /vehicles\/create-vehicle|\bcreateVehicle\b/.test(code(rel)));
    expect(offenders).toEqual([]);
  });

  it("the only non-test caller of createVehicle anywhere in src is its own definition", () => {
    const callers = sourceFiles(SRC).filter((rel) => /\bcreateVehicle\s*\(/.test(code(rel)));
    expect(callers).toEqual(["lib/vehicles/create-vehicle.ts"]);
  });

  it("the only code that inserts a Vehicle row is the direct primitive (unreachable) and the onboarding shell", () => {
    const writers = sourceFiles(SRC).filter((rel) => /\.vehicle\.create\s*\(/.test(code(rel)));
    expect(writers.sort()).toEqual(["lib/vehicles/create-vehicle.ts", "lib/vehicles/onboarding/create-draft-shell.ts"]);
  });

  it("the onboarding shell is created with NO business values (nothing to bypass review with)", () => {
    expect(code("lib/vehicles/onboarding/create-draft-shell.ts")).toMatch(/tx\.vehicle\.create\(\{ data: \{ assetId: asset\.id \} \}\)/);
  });
});

describe("vehicle registration is independent of rental access and verticals", () => {
  const REGISTRATION_SOURCES = [
    "lib/vehicles/onboarding/create-draft-shell.ts",
    "lib/vehicles/onboarding/finalize-vehicle.ts",
    "lib/vehicles/onboarding/delete-draft-vehicle.ts",
    "lib/vehicles/onboarding/vehicle-create-access.ts",
    "app/[locale]/provider/vehicles/new/page.tsx",
    "app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx",
    "app/[locale]/provider/vehicles/new/[vehicleId]/onboarding-actions.ts",
    "app/[locale]/provider/vehicles/page.tsx",
    "app/api/provider/vehicles/onboarding/upload/route.ts",
  ];

  it.each(REGISTRATION_SOURCES)("%s never consults the rental workspace predicate", (rel) => {
    expect(code(rel)).not.toMatch(/rental-workspace-access|canViewRentalWorkspace|resolveRentalWorkspaceViewAccess/);
  });

  it.each(REGISTRATION_SOURCES)("%s never reads or writes a vertical, category grant or offering", (rel) => {
    expect(code(rel)).not.toMatch(/providerVertical|ProviderVertical|providerCategory|rentalOffering|guidedTourVehicleOffering|tourServiceVehicle/);
  });

  it("the rental workspace gate itself is untouched: it still requires the RENTAL_COMPANY authorization, not a vehicle", () => {
    const gate = code("lib/offerings/rental/provider/rental-workspace-access.ts");
    expect(gate).toMatch(/assertRentalDraftAuthorized/);
    expect(gate).not.toMatch(/vehicle/i);
  });
});
