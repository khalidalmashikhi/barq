import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { toPublicVehicle, isVehicleSelectable, type PublicVehicleDTO, type VehicleWithAsset } from "../vehicle-dto";

// VEHICLE-1 — the public-safe vehicle read primitive, built for FUTURE Tour/
// Service surfaces (TOUR-VEHICLE). It returns the allowlisted PublicVehicleDTO
// only (never registrationNumber/status/documents), and — FAIL-CLOSED — only for
// an operationally ACTIVE vehicle (isVehicleSelectable). REGISTERED / VERIFIED /
// UNDER_MAINTENANCE / DEACTIVATED all resolve to null, so a not-yet-activated or
// non-operational vehicle is never exposed. No auth gate: this is customer-facing
// by design.
//
// DELIBERATELY NOT WIRED into any public service/tour page in this gate — it
// exists so the later tour integration consumes one server-authoritative
// projection instead of re-deriving a public shape at each call site.

export async function getPublicVehicle(assetId: string): Promise<PublicVehicleDTO | null> {
  if (!isValidUuid(assetId)) return null;

  const row = await prisma.vehicle.findFirst({
    where: { assetId, asset: { assetType: "VEHICLE" } },
    include: { asset: { select: { status: true, providerId: true } } },
  });

  if (!row) return null;
  const typed = row as VehicleWithAsset;
  if (!isVehicleSelectable(typed.asset.status)) return null;

  return toPublicVehicle(typed);
}
