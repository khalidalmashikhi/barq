import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { canViewRentalWorkspace } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import type { CreateShellResult } from "./onboarding-result";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Creates the DRAFT Vehicle SHELL that
// the document-first onboarding wizard uploads the registration document against.
//
// Why a shell exists at all (Option A): an AssetDocument requires a parent Asset (assetId is a
// required FK), so the registration document — and therefore the whole reused Slice-2/3A
// extraction + review pipeline — can only attach to an already-created Asset. We create an
// all-NULL Vehicle on a REGISTERED/DRAFT Asset: every business field is schema-nullable, so there
// are NO placeholder/fake values, and the fail-closed getVehicleSelectabilityBlockers primitive
// keeps a DRAFT/REGISTERED vehicle out of every customer/offering surface. The confirmed values
// are written to THIS row only at finalize (finalize-vehicle.ts); nothing public is created here.
//
// Server-authoritative + gated: providerId is session-derived, and the capability is restricted to
// the RENTAL_COMPANY vertical (canViewRentalWorkspace) — a tourist-guide provider cannot create a
// rental vehicle through this wizard. Unauthenticated propagates to the route adapter.

export async function createDraftVehicleShell(): Promise<CreateShellResult> {
  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "NOT_RENTAL_PROVIDER" };
    throw error; // UnauthenticatedError → route adapter maps to sign-in.
  }

  if (!(await canViewRentalWorkspace(provider))) return { ok: false, code: "NOT_RENTAL_PROVIDER" };

  try {
    const vehicleId = await prisma.$transaction(async (tx) => {
      // Base Asset (CTI): REGISTERED operational status + DRAFT verification (both schema defaults,
      // set explicitly for intent). Never ACTIVE / APPROVED here — activation stays admin-only.
      const asset = await tx.asset.create({
        data: { providerId: provider.id, assetType: "VEHICLE", status: "REGISTERED" },
      });
      // All business fields NULL — no placeholders. Values arrive only at confirmed finalize.
      await tx.vehicle.create({ data: { assetId: asset.id } });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.onboarding_draft_created",
          entityType: "Vehicle",
          entityId: asset.id,
          newValue: { status: "REGISTERED", verificationStatus: "DRAFT" },
        },
        tx,
      );
      return asset.id;
    });
    return { ok: true, vehicleId };
  } catch (error) {
    logger.error("vehicleOnboarding.create_shell_failed", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
