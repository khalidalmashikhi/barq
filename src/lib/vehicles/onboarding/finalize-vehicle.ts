import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { isValidUuid } from "@/lib/uuid";
import { isVehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";
import { publicDescriptionSchema } from "@/lib/vehicles/vehicle-input";
import { parseConfirmation, type ConfirmationValues } from "@/lib/vehicles/registration-review/confirmation-input";
import { mapExtractedByField } from "@/lib/vehicles/registration-review/extracted-mapping";
import { computeFieldDecisions, correctedFieldCount } from "@/lib/vehicles/registration-review/diff";
import { confirmationColumns, serializeFieldDecisions, columnsToValues } from "@/lib/vehicles/registration-review/confirmation-record";
import { CONFIRMATION_FIELD_KEYS } from "@/lib/vehicles/registration-review/field-model";
import type { FinalizeResult, OnboardingFieldError } from "./onboarding-result";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. The SINGLE transactional writer that
// turns a reviewed DRAFT shell into a real DRAFT Vehicle: it validates the provider's confirmed
// values + chosen vehicle-type, locks the confirmation claim to SUBMITTED, and applies the
// confirmed values to the Vehicle row — all in ONE transaction. No value from the parser reaches
// the Vehicle except through this confirmed, declaration-gated path.
//
// Exactly-once: the confirmation's DRAFT→SUBMITTED transition is the arbiter. An active DRAFT is
// flipped with a version CAS; with no active claim a SUBMITTED row is created (the partial-unique
// "one active claim per document" index makes a concurrent create a P2002). A non-stale SUBMITTED
// claim already present means finalize ran — we re-assert the Vehicle values from the LOCKED claim
// (idempotent) and report alreadyCreated. A document replaced since review supersedes the claim
// and forces re-review (never writes a Vehicle from stale suggestions).
//
// Owner-scoped, session-derived, and gated ONLY by the general vehicle authority (an APPROVED
// provider) — never by the rental workspace or any vertical. Registering a vehicle grants no
// commercial permission: this function writes nothing but the Vehicle row + its confirmation claim,
// so a tourist guide who registers a vehicle gains no rental access. Sensitive values
// (plate/VIN/engine) go to PRIVATE columns only; the audit payload carries counts, never values.

// Select every stored confirmation column so a LOCKED claim can be re-applied idempotently.
const confirmationColumnSelect = Object.fromEntries(CONFIRMATION_FIELD_KEYS.map((k) => [k, true])) as Record<string, true>;

function isP2002(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function isDuplicatePlate(e: Prisma.PrismaClientKnownRequestError): boolean {
  const target = e.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  return text.toLowerCase().includes("registrationnumber");
}

// Map confirmed values + the chosen vehicle-type CODE onto the Vehicle columns. plateNumber is the
// private registrationNumber. The provider's ADVISORY 4x4 declaration and optional description are
// written separately, only by the authoritative first application (never on an idempotent replay);
// the TRUSTED fourByFourVerified flag is admin-only and is never touched here.
function vehicleUpdateData(values: ConfirmationValues, vehicleType: string) {
  const str = (x: string | number | null) => (typeof x === "string" ? x : null);
  const num = (x: string | number | null) => (typeof x === "number" ? x : null);
  return {
    make: str(values.make),
    model: str(values.model),
    modelYear: num(values.modelYear),
    color: str(values.color),
    vehicleType,
    registrationNumber: str(values.plateNumber),
    bookablePassengerCapacity: num(values.bookablePassengerCapacity),
    licensedPassengerCapacity: num(values.licensedPassengerCapacity),
    registeredSeats: num(values.registeredSeats),
  };
}

export async function finalizeVehicleFromRegistration(vehicleId: string, rawInput: Record<string, unknown>): Promise<FinalizeResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };

  let barqUser, provider;
  try {
    const auth = await requireApprovedProvider();
    barqUser = auth.barqUser;
    provider = auth.provider;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "PROVIDER_NOT_APPROVED" };
    throw error; // UnauthenticatedError → route adapter.
  }

  // Validate the confirmed claim (SUBMIT mode: all required fields + capacity chain + declaration)
  // AND the separately-chosen vehicle type, BEFORE opening a transaction.
  const parsed = parseConfirmation(rawInput, "SUBMIT");
  const vehicleTypeRaw = typeof rawInput.vehicleType === "string" ? rawInput.vehicleType : null;
  const vehicleTypeOk = vehicleTypeRaw !== null && isVehicleTypeCode(vehicleTypeRaw);
  // Wizard-only inputs: the optional customer-facing description (same rule as the edit form) and
  // the provider's ADVISORY 4x4 declaration (true when declared, otherwise null = not declared).
  const description = publicDescriptionSchema.safeParse(rawInput.publicDescription ?? null);
  const claimedFourByFour = rawInput.claimedFourByFour === true || rawInput.claimedFourByFour === "true" || rawInput.claimedFourByFour === "on" ? true : null;
  if (!parsed.ok || !vehicleTypeOk || !description.success) {
    const fieldErrors: OnboardingFieldError[] = parsed.ok ? [] : [...parsed.errors];
    if (!vehicleTypeOk) fieldErrors.push({ field: "vehicleType", code: "REQUIRED" });
    if (!description.success) fieldErrors.push({ field: "publicDescription", code: "INVALID" });
    return { ok: false, code: "INVALID_INPUT", fieldErrors };
  }
  const vehicleType = vehicleTypeRaw;
  const publicDescription = description.data;

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize against cancel (deleteDraftVehicle takes the same row lock): whichever commits
      // first wins and the other re-reads the truth — a cancel can never delete a shell this
      // transaction is finalizing, and a finalize can never resurrect a cancelled one.
      await tx.$queryRaw`SELECT "id" FROM "assets" WHERE "id" = ${vehicleId}::uuid FOR UPDATE`;
      const asset = await tx.asset.findFirst({
        where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
        select: {
          id: true,
          vehicle: { select: { assetId: true, make: true, vehicleType: true } },
          documents: {
            where: { type: "VEHICLE_REGISTRATION" },
            select: {
              id: true,
              registrationExtraction: { select: { id: true, documentSha256: true, parserVersion: true, fields: true } },
              registrationConfirmations: {
                where: { status: { not: "SUPERSEDED" } },
                select: { id: true, status: true, version: true, boundDocumentSha256: true, boundParserVersion: true, ...confirmationColumnSelect },
              },
            },
          },
        },
      });
      if (!asset || !asset.vehicle) return { ok: false, code: "VEHICLE_NOT_FOUND" } as const;
      const doc = asset.documents[0];
      if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" } as const;
      const extraction = doc.registrationExtraction;
      if (!extraction) return { ok: false, code: "EXTRACTION_NOT_READY" } as const;

      const active = doc.registrationConfirmations[0] ?? null;
      const stale = active
        ? active.boundDocumentSha256 !== extraction.documentSha256 || active.boundParserVersion !== extraction.parserVersion
        : false;

      // Document replaced since review → supersede as-is and force re-review. Never create a
      // Vehicle from suggestions bound to a document the provider no longer has.
      if (active && stale) {
        const superseded = await tx.vehicleRegistrationConfirmation.updateMany({
          where: { id: active.id, version: active.version, status: { not: "SUPERSEDED" } },
          data: { status: "SUPERSEDED" },
        });
        if (superseded.count === 0) return { ok: false, code: "CONFLICT" } as const;
        await recordAuditEvent(
          { actorType: "PROVIDER", actorId: provider.id, action: "vehicle.registration_confirmation_superseded", entityType: "Vehicle", entityId: asset.id, previousValue: { status: active.status }, newValue: { status: "SUPERSEDED" } },
          tx,
        );
        return { ok: false, code: "SUPERSEDED" } as const;
      }

      // Already SUBMITTED (idempotent re-tap / concurrent loser's winner / detail-page submit):
      // re-assert the Vehicle from the LOCKED claim so the row always mirrors the submitted values,
      // then report alreadyCreated. Keeps exactly-once: no second Vehicle, no value drift.
      if (active && active.status === "SUBMITTED") {
        const locked = columnsToValues(active as Record<string, string | number | null>);
        const keepType = typeof asset.vehicle.vehicleType === "string" ? asset.vehicle.vehicleType : vehicleType;
        await tx.vehicle.update({ where: { assetId: asset.id }, data: vehicleUpdateData(locked, keepType) });
        return { ok: true, vehicleId, alreadyCreated: true } as const;
      }

      const decisions = computeFieldDecisions(mapExtractedByField(extraction.fields).values, parsed.values);
      const now = new Date();
      const claim = {
        ...confirmationColumns(parsed.values),
        fieldDecisions: serializeFieldDecisions(decisions),
        boundDocumentSha256: extraction.documentSha256,
        boundParserVersion: extraction.parserVersion,
        status: "SUBMITTED" as const,
        declarationAccepted: parsed.declarationAccepted,
        submittedAt: now,
        submittedByUserId: barqUser.id,
      };

      if (active) {
        // Active DRAFT → lock to SUBMITTED with a version CAS (concurrent loser → count 0).
        const upd = await tx.vehicleRegistrationConfirmation.updateMany({
          where: { id: active.id, version: active.version },
          data: { ...claim, version: active.version + 1 },
        });
        if (upd.count === 0) return { ok: false, code: "CONFLICT" } as const;
      } else {
        // No claim yet → create SUBMITTED (partial-unique makes a concurrent create a P2002).
        await tx.vehicleRegistrationConfirmation.create({
          data: { providerId: provider.id, assetId: asset.id, assetDocumentId: doc.id, extractionId: extraction.id, ...claim },
        });
      }

      // Apply the confirmed values to the DRAFT Vehicle in the SAME transaction. A duplicate plate
      // trips registrationNumber's unique index → DUPLICATE_REGISTRATION (whole tx rolls back).
      await tx.vehicle.update({ where: { assetId: asset.id }, data: { ...vehicleUpdateData(parsed.values, vehicleType), claimedFourByFour, publicDescription } });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.created_from_registration",
          entityType: "Vehicle",
          entityId: asset.id,
          newValue: { vehicleType, correctedFields: correctedFieldCount(decisions) }, // metadata only — no values/PII
        },
        tx,
      );
      return { ok: true, vehicleId, alreadyCreated: false } as const;
    });
  } catch (error) {
    if (isP2002(error)) return { ok: false, code: isDuplicatePlate(error) ? "DUPLICATE_REGISTRATION" : "CONFLICT" };
    logger.error("vehicleOnboarding.finalize_failed", { vehicleId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
