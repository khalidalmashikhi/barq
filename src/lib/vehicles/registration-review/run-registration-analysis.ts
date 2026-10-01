import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { runVehicleRegistrationExtraction } from "@/lib/vehicles/registration-extraction/extract-registration-service";
import { extractionFailureLabelKey } from "./review-status";
import type { RegistrationAnalysisResult } from "./registration-review-result";

// Phase 3C Slice 3A — orchestrates the Slice-2 extraction engine from the provider workflow WITHOUT
// a public endpoint. Owner-scoped: the provider is re-derived from the session and the asset +
// VEHICLE_REGISTRATION document are re-read under that provider id before the (idempotent,
// concurrency-safe) extraction service is invoked. Throws on auth (the action wrapper maps it);
// returns a coded result for domain outcomes. NEVER parses inside an upload transaction and NEVER
// mutates the Vehicle.

export async function runRegistrationAnalysis(vehicleId: string): Promise<RegistrationAnalysisResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: { documents: { where: { type: "VEHICLE_REGISTRATION" }, select: { id: true } } },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const doc = asset.documents[0];
  if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" };

  const res = await runVehicleRegistrationExtraction({ assetDocumentId: doc.id });
  if (!res.ok) {
    switch (res.error) {
      case "STORAGE_NOT_CONFIGURED":
        return { ok: false, code: "STORAGE_NOT_CONFIGURED" };
      case "DOCUMENT_NOT_FOUND":
      case "WRONG_DOCUMENT_TYPE":
      case "NOT_A_VEHICLE":
        return { ok: false, code: "DOCUMENT_NOT_FOUND" };
      default:
        return { ok: false, code: "EXTRACTION_FAILED" };
    }
  }
  return { ok: true, status: res.status, failureLabelKey: res.status === "FAILED" ? extractionFailureLabelKey(res.failureCode) : null };
}
