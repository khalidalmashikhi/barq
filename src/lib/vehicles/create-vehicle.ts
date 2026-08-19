import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { parseVehicleInput, type VehicleInput } from "./vehicle-input";
import type { VehicleActionErrorCode } from "./vehicle-errors";

// VEHICLE-1 — create a provider-owned Vehicle (Asset + Vehicle, one transaction).
//
// Server-authoritative: providerId is derived from the session (never client
// input), assetType is fixed to VEHICLE, and a new Asset starts REGISTERED (the
// existing AssetStatus default). This primitive touches NO ProviderCategory, NO
// Service, NO Booking — vehicle ownership grants zero commercial authorization
// (B4/B5 stay authoritative). A provider may own MANY vehicles: nothing here
// caps the count.

export type CreateVehicleResult = { ok: true; vehicleId: string } | { ok: false; error: VehicleActionErrorCode };

// Audit payload deliberately EXCLUDES the raw registrationNumber (a private
// value) — only whether one was supplied is recorded.
function auditPayload(value: VehicleInput): Prisma.InputJsonObject {
  return {
    make: value.make,
    model: value.model,
    modelYear: value.modelYear,
    color: value.color,
    vehicleType: value.vehicleType,
    passengerCapacity: value.passengerCapacity,
    publicDescription: value.publicDescription,
    hasRegistration: value.registrationNumber !== null,
  };
}

function isDuplicateRegistration(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createVehicle(rawInput: unknown): Promise<CreateVehicleResult> {
  const parsed = parseVehicleInput(rawInput);
  if (!parsed.ok) return { ok: false, error: "INVALID_INPUT" };
  const value = parsed.value;

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error; // UnauthenticatedError → handled by the future action/API adapter
  }

  try {
    const vehicleId = await prisma.$transaction(async (tx) => {
      // Class-Table-Inheritance: the base Asset owns providerId/type/status; the
      // Vehicle row shares its primary key (assetId).
      const asset = await tx.asset.create({
        data: { providerId: provider.id, assetType: "VEHICLE", status: "REGISTERED" },
      });

      await tx.vehicle.create({
        data: {
          assetId: asset.id,
          make: value.make,
          model: value.model,
          modelYear: value.modelYear,
          color: value.color,
          vehicleType: value.vehicleType,
          passengerCapacity: value.passengerCapacity,
          publicDescription: value.publicDescription,
          registrationNumber: value.registrationNumber,
        },
      });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.created",
          entityType: "Vehicle",
          entityId: asset.id,
          newValue: auditPayload(value),
        },
        tx,
      );

      return asset.id;
    });

    return { ok: true, vehicleId };
  } catch (error) {
    // A duplicate NON-NULL registration number trips the unique index. Return a
    // generic code — never reveal which provider owns the conflicting plate.
    if (isDuplicateRegistration(error)) {
      return { ok: false, error: "DUPLICATE_REGISTRATION" };
    }
    logger.error("createVehicle.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
