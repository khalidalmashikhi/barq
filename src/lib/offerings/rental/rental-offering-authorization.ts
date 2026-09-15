import "server-only";
import type { Prisma, PrismaClient, AssetStatus, AssetVerificationStatus, RentalOfferingStatus } from "@prisma/client";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { assertCanCreateListing } from "@/lib/provider/verticals/require-approved-vertical";
import { evaluateVerticalCompliance } from "@/lib/provider/verticals/require-approved-vertical";
import { getVehicleSelectabilityBlockers } from "@/lib/vehicles/selectability";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";
import type { RentalOfferingErrorCode } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — the SHARED, TRANSACTION-CAPABLE authorization + resource-loading authority
// for rental-offering write management. Every check that decides authorization or resource validity
// runs against the caller-supplied db client (the mutation's tx), so a mutation never authorizes on
// one snapshot and writes against another (TOCTOU-safe). Provider identity is ALWAYS session-derived
// (requireApprovedProvider); a client-supplied provider id is never trusted.
//
// A foreign Service / Vehicle / Offering always resolves to a uniform *_NOT_FOUND (non-enumerating):
// ownership is a where-clause predicate, so a foreign resource simply does not match.

export type DbClient = PrismaClient | Prisma.TransactionClient;

const RENTAL_VERTICAL = "RENTAL_COMPANY" as const;
const RENTAL_OFFERING_KIND = "VEHICLE_RENTAL" as const;

/** Resolve the approved session provider, mapping auth exceptions to result codes (Unauth bubbles). */
export async function resolveApprovedProvider(): Promise<{ ok: true; providerId: string } | { ok: false; error: RentalOfferingErrorCode }> {
  try {
    const { provider } = await requireApprovedProvider();
    return { ok: true, providerId: provider.id };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error; // UnauthenticatedError → the server action / API adapter handles it
  }
}

// The vehicle + base-asset + document snapshot used for selectability + capacity, fetched with the
// offering / at create time. Never selects objectKey or any private storage field.
export const RENTAL_VEHICLE_SELECT = {
  assetId: true,
  bookablePassengerCapacity: true,
  asset: {
    select: {
      providerId: true,
      assetType: true,
      status: true,
      verificationStatus: true,
      documents: { select: { type: true, status: true, expiresAt: true } },
    },
  },
} as const;

export type LoadedRentalVehicle = {
  assetId: string;
  bookablePassengerCapacity: number | null;
  asset: {
    providerId: string;
    assetType: string;
    status: AssetStatus;
    verificationStatus: AssetVerificationStatus;
    documents: { type: string; status: import("@prisma/client").AssetDocumentStatus; expiresAt: Date | null }[];
  };
};

export type LoadedRentalOffering = {
  id: string;
  serviceId: string;
  vehicleId: string;
  status: RentalOfferingStatus;
  baseDailyAmount: Prisma.Decimal;
  currency: string;
  offeringCapacityOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
  serviceOfferingKind: string | null;
  vehicle: LoadedRentalVehicle;
};

/**
 * Load a rental offering the session provider OWNS (scoped by service.providerId), with its Service
 * offering kind and its Vehicle + asset + documents. A missing / foreign offering → null (the caller
 * maps to the uniform OFFERING_NOT_FOUND).
 */
export async function loadOwnedRentalOffering(db: DbClient, providerId: string, offeringId: string): Promise<LoadedRentalOffering | null> {
  const row = await db.rentalOffering.findFirst({
    where: { id: offeringId, service: { providerId } },
    select: {
      id: true,
      serviceId: true,
      vehicleId: true,
      status: true,
      baseDailyAmount: true,
      currency: true,
      offeringCapacityOverride: true,
      createdAt: true,
      updatedAt: true,
      service: { select: { offeringKind: true } },
      vehicle: { select: RENTAL_VEHICLE_SELECT },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    serviceId: row.serviceId,
    vehicleId: row.vehicleId,
    status: row.status,
    baseDailyAmount: row.baseDailyAmount,
    currency: row.currency,
    offeringCapacityOverride: row.offeringCapacityOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    serviceOfferingKind: row.service.offeringKind,
    vehicle: row.vehicle as unknown as LoadedRentalVehicle,
  };
}

export type OwnedServiceAndVehicle = { serviceOfferingKind: string | null; vehicle: LoadedRentalVehicle };

/**
 * For CREATE: verify the session provider owns BOTH the Service (with a VEHICLE_RENTAL offering kind)
 * and the Vehicle (a VEHICLE asset of the same provider). Uniform not-found on any foreign/missing
 * resource. Does NOT check publish compliance (that is a separate gate).
 */
export async function loadOwnedServiceAndVehicleForCreate(
  db: DbClient,
  providerId: string,
  serviceId: string,
  vehicleId: string,
): Promise<{ ok: true; value: OwnedServiceAndVehicle } | { ok: false; error: RentalOfferingErrorCode }> {
  const service = await db.service.findFirst({ where: { id: serviceId, providerId }, select: { offeringKind: true } });
  if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };
  if (service.offeringKind !== RENTAL_OFFERING_KIND) return { ok: false, error: "WRONG_SERVICE_KIND" };

  const vehicle = await db.vehicle.findFirst({
    where: { assetId: vehicleId, asset: { providerId, assetType: "VEHICLE" } },
    select: RENTAL_VEHICLE_SELECT,
  });
  if (!vehicle) return { ok: false, error: "VEHICLE_NOT_FOUND" };

  return { ok: true, value: { serviceOfferingKind: service.offeringKind, vehicle: vehicle as unknown as LoadedRentalVehicle } };
}

/**
 * DRAFT preparation gate: the RENTAL_COMPANY vertical must be requested and draft-eligible (PENDING /
 * CHANGES_REQUESTED / APPROVED); REJECTED / SUSPENDED / absent fail closed. Maps the vertical code to
 * this domain's vocabulary. A guide-only provider (no RENTAL_COMPANY vertical) → VERTICAL_NOT_AUTHORIZED.
 */
export async function assertRentalDraftAuthorized(providerId: string): Promise<RentalOfferingErrorCode | null> {
  const code = await assertCanCreateListing(providerId, RENTAL_OFFERING_KIND);
  return code === null ? null : "VERTICAL_NOT_AUTHORIZED";
}

/**
 * PUBLISH / live-edit readiness (TOCTOU-safe): the RENTAL_COMPANY vertical must be APPROVED AND
 * currently COMPLIANT (policy configured + required docs present/approved/unexpired), AND the Vehicle
 * must be SELECTABLE (ACTIVE + APPROVED + required docs valid), AND a verified bookable capacity must
 * exist. Runs the compliance re-check on the supplied db (tx) client. Returns the first blocker code
 * or null when fully ready. `now` is injectable for deterministic tests.
 */
export async function assertRentalPublishReady(
  db: DbClient,
  providerId: string,
  vehicle: LoadedRentalVehicle,
  now: Date = new Date(),
): Promise<RentalOfferingErrorCode | null> {
  const compliance = await evaluateVerticalCompliance(providerId, RENTAL_VERTICAL, db);
  if (!compliance.compliant) {
    return compliance.reason === "VERTICAL_DOCUMENTS_INCOMPLETE" || compliance.reason === "VERTICAL_POLICY_NOT_CONFIGURED"
      ? "VERTICAL_NOT_COMPLIANT"
      : "VERTICAL_NOT_AUTHORIZED";
  }

  const blockers = getVehicleSelectabilityBlockers({
    status: vehicle.asset.status,
    verificationStatus: vehicle.asset.verificationStatus,
    requiredDocumentTypes: requiredAssetDocumentTypesFor("VEHICLE"),
    documents: vehicle.asset.documents.map((d) => ({ type: d.type, status: d.status, expiresAt: d.expiresAt })),
    now,
  });
  if (blockers.length > 0) return "VEHICLE_NOT_SELECTABLE";

  if (vehicle.bookablePassengerCapacity === null || vehicle.bookablePassengerCapacity <= 0) {
    return "VERIFIED_CAPACITY_MISSING";
  }
  return null;
}

/**
 * Content-edit authorization for a loaded (non-archived) offering: a PUBLISHED offering runs the
 * full live compliance/readiness re-check (vertical + vehicle + capacity), while DRAFT/SUSPENDED
 * require only a valid draft-eligible RENTAL_COMPANY vertical identity. Returns the blocker code or
 * null. Callers must handle ARCHIVED (immutable) before calling this.
 */
export async function assertRentalEditAuthorized(
  db: DbClient,
  providerId: string,
  offering: LoadedRentalOffering,
  now: Date = new Date(),
): Promise<RentalOfferingErrorCode | null> {
  if (offering.status === "PUBLISHED") {
    return assertRentalPublishReady(db, providerId, offering.vehicle, now);
  }
  return assertRentalDraftAuthorized(providerId);
}

/** Map a Prisma P2002 (the C1 partial-unique index) to the stable OFFERING_ALREADY_ACTIVE code. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
