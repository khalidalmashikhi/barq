import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { toPublicVehicle, toProviderVehicle, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";

// Gate 7 — privacy & authorization boundary for the durable cleanup mechanism.

const ROOT = process.cwd();

describe("private-object cleanup — privacy & boundary", () => {
  it("the cleanup domain is server-only (cannot be imported into a client bundle)", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/storage/cleanup/private-object-cleanup.ts"), "utf8");
    expect(src.startsWith('import "server-only"')).toBe(true);
  });

  it("the ONLY app route that reaches the cleanup worker is the CRON_SECRET-protected cron", () => {
    const appDir = path.join(ROOT, "src/app");
    const offenders: string[] = [];
    for (const entry of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith("route.ts") && !entry.endsWith("route.tsx")) continue;
      const rel = entry.replace(/\\/g, "/");
      if (rel.endsWith("route.test.ts")) continue;
      const content = readFileSync(path.join(appDir, entry), "utf8");
      if (/storage\/cleanup\/private-object-cleanup|runPrivateObjectCleanup/.test(content)) {
        if (!rel.includes("cron/cleanup-private-objects/route.ts")) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("neither the public nor the provider vehicle DTO exposes any object key or cleanup field", () => {
    const row: VehicleWithAsset = {
      assetId: "veh-1", make: "Toyota", model: "Prado", modelYear: 2020, color: "White", vehicleType: "SUV",
      bookablePassengerCapacity: 6, registeredSeats: 7, licensedPassengerCapacity: 7, publicDescription: null,
      registrationNumber: "OM 1", claimedFourByFour: true, fourByFourVerified: true,
      createdAt: new Date(), updatedAt: new Date(), asset: { status: "ACTIVE", providerId: "p1" },
    };
    for (const dto of [toPublicVehicle(row), toProviderVehicle(row)]) {
      const json = JSON.stringify(dto);
      expect(json).not.toMatch(/objectKey|cleanup|private_object/i);
    }
  });
});
