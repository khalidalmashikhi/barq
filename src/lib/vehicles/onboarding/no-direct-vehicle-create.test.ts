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
    expect(writers.sort()).toEqual(["lib/vehicles/create-vehicle.ts", "lib/vehicles/onboarding/start-vehicle-onboarding.ts"]);
  });

  it("the onboarding shell is created with NO business values (nothing to bypass review with)", () => {
    expect(code("lib/vehicles/onboarding/start-vehicle-onboarding.ts")).toMatch(/tx\.vehicle\.create\(\{ data: \{ assetId \} \}\)/);
  });
});

describe("vehicle registration is independent of rental access and verticals", () => {
  const REGISTRATION_SOURCES = [
    "lib/vehicles/onboarding/start-vehicle-onboarding.ts",
    "lib/vehicles/onboarding/onboarding-request.ts",
    "lib/vehicles/onboarding/cancel-onboarding-request.ts",
    "lib/vehicles/onboarding/onboarding-request-key-store.ts",
    "app/[locale]/provider/vehicles/new/upload-actions.ts",
    "app/[locale]/provider/vehicles/_components/add-vehicle-link.tsx",
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

  it("idempotency lives in the durable request record — the Asset carries no idempotency data", () => {
    const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    const from = schema.indexOf("model Asset {");
    const asset = schema.slice(from, schema.indexOf("@@map(\"assets\")", from));
    expect(from).toBeGreaterThan(0);
    expect(asset).not.toMatch(/onboardingRequestKey|idempotencyKey/);
    expect(asset).toMatch(/onboardingRequest\s+VehicleOnboardingRequest\?/); // back-relation only
    expect(code("lib/vehicles/onboarding/start-vehicle-onboarding.ts")).not.toMatch(/onboardingRequestKey/);
  });

  it("the request table is written ONLY by its own module and the cancel-by-key operation", () => {
    const writers = sourceFiles(SRC).filter((rel) => /vehicleOnboardingRequest\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(code(rel)));
    expect(writers.sort()).toEqual(["lib/vehicles/onboarding/cancel-onboarding-request.ts", "lib/vehicles/onboarding/onboarding-request.ts"]);
  });

  it("a request row is NEVER deleted when a setup is cancelled — only the bounded retention purge removes rows", () => {
    const deleters = sourceFiles(SRC).filter((rel) => /vehicleOnboardingRequest\.(delete|deleteMany)\s*\(/.test(code(rel)));
    expect(deleters).toEqual(["lib/vehicles/onboarding/onboarding-request.ts"]);
    const mod = code("lib/vehicles/onboarding/onboarding-request.ts");
    expect((mod.match(/vehicleOnboardingRequest\.deleteMany\(/g) ?? []).length).toBe(1); // the purge, and nothing else
    expect(code("lib/vehicles/onboarding/delete-draft-vehicle.ts")).toMatch(/tombstoneOnboardingRequestForAsset\(tx, asset\.id\)/);
    expect(code("lib/vehicles/onboarding/delete-draft-vehicle.ts")).not.toMatch(/vehicleOnboardingRequest\./);
  });

  it("the request record (and its key) is read by NO DTO, public reader, page or API serializer", () => {
    const readers = sourceFiles(SRC).filter((rel) => /vehicleOnboardingRequest|idempotencyKey:\s*requestKey|onboardingRequest:/.test(code(rel)));
    expect(readers.sort()).toEqual(["lib/vehicles/onboarding/cancel-onboarding-request.ts", "lib/vehicles/onboarding/onboarding-request.ts"]);
  });

  it("the rental workspace gate itself is untouched: it still requires the RENTAL_COMPANY authorization, not a vehicle", () => {
    const gate = code("lib/offerings/rental/provider/rental-workspace-access.ts");
    expect(gate).toMatch(/assertRentalDraftAuthorized/);
    expect(gate).not.toMatch(/vehicle/i);
  });
});
