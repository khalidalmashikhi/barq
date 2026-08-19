import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { parseVehicleInput, type VehicleInput } from "./vehicle-input";
import type { VehicleActionErrorCode } from "./vehicle-errors";

// VEHICLE-1 — update a provider-owned Vehicle. A provider may mutate ONLY its own
// vehicles: ownership is enforced by a providerId-scoped lookup, so another
// provider's vehicle resolves to VEHICLE_NOT_FOUND (never revealed, never
// mutable). The vehicle cannot be transferred (providerId is never written) and
// its assetType cannot change (never written). No B4/B5 / Service / Booking
// mutation. Same strict validation as create.

export type UpdateVehicleResult = { ok: true } | { ok: false; error: VehicleActionErrorCode };

function auditPayload(value: {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  passengerCapacity: number | null;
  publicDescription: string | null;
  registrationNumber: string | null;
}): Prisma.InputJsonObject {
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

export async function updateVehicle(assetId: string, rawInput: unknown): Promise<UpdateVehicleResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };

  const parsed = parseVehicleInput(rawInput);
  if (!parsed.ok) return { ok: false, error: "INVALID_INPUT" };
  const value: VehicleInput = parsed.value;

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ownership gate: scope by providerId + VEHICLE type. A vehicle owned by
      // someone else simply does not match → treated as not found.
      const asset = await tx.asset.findFirst({
        where: { id: assetId, providerId: provider.id, assetType: "VEHICLE" },
        include: { vehicle: true },
      });
      if (!asset || !asset.vehicle) return "VEHICLE_NOT_FOUND" as const;

      const before = asset.vehicle;

      await tx.vehicle.update({
        where: { assetId },
        data: {
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
          action: "vehicle.updated",
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: auditPayload(before),
          newValue: auditPayload(value),
        },
        tx,
      );

      return "OK" as const;
    });

    return result === "OK" ? { ok: true } : { ok: false, error: result };
  } catch (error) {
    if (isDuplicateRegistration(error)) {
      return { ok: false, error: "DUPLICATE_REGISTRATION" };
    }
    logger.error("updateVehicle.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
