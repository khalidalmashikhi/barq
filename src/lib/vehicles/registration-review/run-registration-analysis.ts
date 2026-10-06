import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { runVehicleRegistrationExtraction } from "@/lib/vehicles/registration-extraction/extract-registration-service";
import { extractionFailureLabelKey, OCR_CONSENT_REQUIRED_CODE } from "./review-status";
import type { RegistrationAnalysisResult } from "./registration-review-result";

// Phase 3C Slice 3A — orchestrates the Slice-2 extraction engine from the provider workflow WITHOUT
// a public endpoint. Owner-scoped: the provider is re-derived from the session and the asset +
// VEHICLE_REGISTRATION document are re-read under that provider id before the (idempotent,
// concurrency-safe) extraction service is invoked. Throws on auth (the action wrapper maps it);
// returns a coded result for domain outcomes. NEVER parses inside an upload transaction and NEVER
// mutates the Vehicle. For a photo or scanned PDF the service may call the configured OCR engine —
// only with the provider's recorded consent for that document, at most once per document, within
// the acting user's call budget: a repeat for the same bytes is answered from the stored result,
// and a request that arrives while one is in flight is told PROCESSING.

export async function runRegistrationAnalysis(vehicleId: string): Promise<RegistrationAnalysisResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { barqUser, provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: { documents: { where: { type: "VEHICLE_REGISTRATION" }, select: { id: true } } },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const doc = asset.documents[0];
  if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" };

  const res = await runVehicleRegistrationExtraction({ assetDocumentId: doc.id, actorUserId: barqUser.id });
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
  // PROCESSING = another request is already reading this document; nothing was repeated here.
  // A photo/scan whose external reading awaits the provider's choice is not a failure to label.
  const awaitingConsent = res.status === "FAILED" && res.failureCode === OCR_CONSENT_REQUIRED_CODE;
  return {
    ok: true,
    status: awaitingConsent ? "AWAITING_CONSENT" : res.status,
    failureLabelKey: res.status === "FAILED" && !awaitingConsent ? extractionFailureLabelKey(res.failureCode) : null,
  };
}
