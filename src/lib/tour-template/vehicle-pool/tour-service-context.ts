import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseGuidingContent } from "../guiding-content";
import type { TourPackageKey } from "../packages";
import type { TourVehiclePoolErrorCode } from "./pool-errors";

// TOUR-VEHICLE-1 — the shared, ownership-scoped loader that turns a serviceId into the
// TOUR context the pool operations/readers need: the owning provider, the package, and
// the declared maxGuests. ONE place resolves "is this the caller's service, and is it a
// tour that can hold a vehicle pool?", so add/remove/readers can never diverge.
//
// Ownership is enforced by the providerId-scoped query: a foreign or missing service is
// the SAME uniform SERVICE_NOT_FOUND, so a provider can never probe another provider's
// services. A service that is not a smart-tour Experience (no Experience row, or its
// guidingContent does not pass the strict contract) is TOUR_SERVICE_NOT_ELIGIBLE — it
// has no package and therefore no vehicle-pool concept.

type DbClient = PrismaClient | Prisma.TransactionClient;

export type TourServiceContext = {
  serviceId: string;
  providerId: string;
  packageType: TourPackageKey;
  /** Declared maximum guest party for the service (guidingContent.maxGuests), or null. */
  maxGuests: number | null;
};

export type TourServiceContextResult =
  | { ok: true; context: TourServiceContext }
  | { ok: false; error: Extract<TourVehiclePoolErrorCode, "SERVICE_NOT_FOUND" | "TOUR_SERVICE_NOT_ELIGIBLE"> };

export async function loadOwnedTourServiceContext(
  db: DbClient,
  providerId: string,
  serviceId: string,
): Promise<TourServiceContextResult> {
  const service = await db.service.findFirst({
    where: { id: serviceId, providerId },
    select: { id: true, providerId: true, experience: { select: { guidingContent: true } } },
  });

  // Foreign OR missing → uniform, non-enumerable.
  if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };

  const guidingContent = service.experience?.guidingContent;
  if (guidingContent == null) return { ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" };

  // Re-validate the stored JSON through the strict contract — never trust the column
  // shape blindly. A legacy/corrupt value fails closed as not-eligible.
  const parsed = parseGuidingContent(guidingContent);
  if (!parsed.ok) return { ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" };

  return {
    ok: true,
    context: {
      serviceId: service.id,
      providerId: service.providerId,
      packageType: parsed.value.packageType,
      maxGuests: parsed.value.maxGuests,
    },
  };
}
