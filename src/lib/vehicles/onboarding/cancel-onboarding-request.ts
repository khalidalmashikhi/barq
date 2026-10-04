import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { isValidIdempotencyKey } from "@/lib/booking/idempotency";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import { deleteDraftVehicle } from "./delete-draft-vehicle";
import { ONBOARDING_REQUEST_RETENTION_MS } from "./onboarding-request-policy";

// Phase 3C Slice 3B — cancel a document-first onboarding BY ITS REQUEST KEY.
//
// Used when the provider abandons the upload step after an attempt whose outcome the browser does
// not know (the connection dropped, or the upload is still in flight). The provider cannot name a
// vehicle id — the browser only knows the key — so the request record is the handle:
//
//   • no request yet      → a CANCELLED tombstone is written, so the delayed upload still travelling
//                           with this key can create nothing when it arrives;
//   • PENDING             → guarded transition to CANCELLED; the in-flight attempt's completion is
//                           guarded on PENDING, so it rolls back and its stored object is removed
//                           through the upload intent;
//   • COMPLETED           → the one setup it produced is cancelled through deleteDraftVehicle (which
//                           tombstones the request in the same transaction). A setup that has since
//                           been confirmed is NOT cancellable here;
//   • CANCELLED           → already terminal (idempotent).
//
// Whichever side of a race commits first, the request converges on one terminal state and no
// half-created graph or stray object remains. The key is scoped to the authenticated provider; it
// is never logged or audited.

export type CancelOnboardingRequestResult =
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "PROVIDER_NOT_APPROVED" | "NOT_CANCELLABLE" | "UNKNOWN_ERROR" };

const MAX_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function cancelledData(now: Date) {
  return { status: "CANCELLED" as const, cancelledAt: now, leaseToken: null, leaseExpiresAt: null, expiresAt: new Date(now.getTime() + ONBOARDING_REQUEST_RETENTION_MS) };
}

export async function cancelVehicleOnboardingRequest(requestKey: unknown): Promise<CancelOnboardingRequestResult> {
  if (!isValidIdempotencyKey(requestKey)) return { ok: false, code: "INVALID_INPUT" };

  let provider;
  try {
    ({ provider } = await requireApprovedProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "PROVIDER_NOT_APPROVED" };
    throw error;
  }
  const where = { providerId_idempotencyKey: { providerId: provider.id, idempotencyKey: requestKey } };
  const audit = (tx: Prisma.TransactionClient, requestId: string, previousStatus: string) =>
    recordAuditEvent(
      // Metadata only — never the request key.
      { actorType: "PROVIDER", actorId: provider.id, action: "vehicle.onboarding_request_cancelled", entityType: "VehicleOnboardingRequest", entityId: requestId, previousValue: { status: previousStatus }, newValue: { status: "CANCELLED" } },
      tx,
    );

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await prisma.vehicleOnboardingRequest.findUnique({ where, select: { id: true, status: true, assetId: true } });
      const now = new Date();

      if (!row) {
        try {
          await prisma.$transaction(async (tx) => {
            const created = await tx.vehicleOnboardingRequest.create({
              data: { providerId: provider.id, idempotencyKey: requestKey, ...cancelledData(now) },
              select: { id: true },
            });
            await audit(tx, created.id, "NONE");
          });
          return { ok: true };
        } catch (error) {
          if (isUniqueViolation(error)) continue; // the delayed request arrived first — re-read it
          throw error;
        }
      }

      if (row.status === "CANCELLED") return { ok: true };

      if (row.status === "COMPLETED" && row.assetId) {
        // Cancel the ONE setup this request produced (owner-scoped, blank-shell-only, durable
        // document cleanup, and the request tombstone — all in deleteDraftVehicle's transaction).
        const result = await deleteDraftVehicle(row.assetId);
        if (result.ok) return { ok: true };
        if (result.code === "NOT_DELETABLE") return { ok: false, code: "NOT_CANCELLABLE" };
        if (result.code === "VEHICLE_NOT_FOUND") continue; // already removed by a concurrent cancel — re-read
        return { ok: false, code: "UNKNOWN_ERROR" };
      }

      // PENDING (possibly with an attempt in flight), or COMPLETED whose setup is already gone.
      const moved = await prisma.$transaction(async (tx) => {
        const res = await tx.vehicleOnboardingRequest.updateMany({ where: { id: row.id, status: row.status, assetId: null }, data: cancelledData(now) });
        if (res.count === 1) await audit(tx, row.id, row.status);
        return res.count === 1;
      });
      if (moved) return { ok: true };
      // The in-flight attempt completed first — loop: the next pass cancels the setup it created.
    }
    return { ok: false, code: "UNKNOWN_ERROR" };
  } catch (error) {
    logger.error("vehicleOnboarding.cancel_request_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
