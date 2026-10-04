import "server-only";
import { requireApprovedProvider, ForbiddenError, UnauthenticatedError } from "@/lib/auth";

// Phase 3C Slice 3B (visual-QA correction) — the ONE page-level gate for new-vehicle creation.
//
// Vehicle-create authority in BARQ is, and has always been, "an APPROVED provider"
// (requireApprovedProvider) — the same rule createVehicle and uploadVehicleDocument enforce. It is
// deliberately independent of provider type, ProviderCategory and every commercial vertical:
// owning/registering a vehicle confers NO commercial permission.
//
// This gate must NEVER consult the rental workspace (canViewRentalWorkspace) or any vertical. That
// predicate answers "may this provider manage standalone rental offerings?", which is a different
// question from "may this provider register a vehicle?". Selecting the vehicle-create UI by the
// rental predicate is what sent non-rental providers to the legacy direct form. A tourist guide may
// register a vehicle (for guided-tour use); a rental company may register a vehicle; neither gains
// anything else by doing so.

export type VehicleCreateDenial = "UNAUTHENTICATED" | "PROVIDER_NOT_APPROVED";

export async function resolveVehicleCreateAccess(): Promise<{ ok: true; providerId: string } | { ok: false; reason: VehicleCreateDenial }> {
  try {
    const { provider } = await requireApprovedProvider();
    return { ok: true, providerId: provider.id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, reason: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, reason: "PROVIDER_NOT_APPROVED" };
    throw error;
  }
}
