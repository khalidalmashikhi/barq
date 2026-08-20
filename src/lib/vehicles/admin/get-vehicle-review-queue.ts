import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";

// VEHICLE-LC3 / LC5 — the admin review QUEUE read model. requireAdmin()-gated.
// Returns only UI-safe fields — never a raw Prisma row, never an objectKey.
//
// The queue carries TWO explicitly-distinguished kinds of work (the `kind` field —
// never inferred from labels or status downstream):
//   • INITIAL     — a SUBMITTED vehicle awaiting its first verification decision
//                   (DRAFT work-in-progress never surfaces).
//   • REMEDIATION — an already-APPROVED vehicle that has a PENDING required document,
//                   which can ONLY arise from an LC5 expired-document replacement (see
//                   isRequiredDocumentRemediable). Without surfacing it here the renewed
//                   document would be invisible to admins, since the initial queue is
//                   SUBMITTED-only. The vehicle's verificationStatus stays APPROVED — the
//                   admin re-reviews just the PENDING document (no whole-vehicle decision).

export type VehicleReviewQueueKind = "INITIAL" | "REMEDIATION";

export type VehicleReviewQueueItem = {
  id: string; // assetId
  kind: VehicleReviewQueueKind;
  providerName: unknown; // bilingual {ar,en} — render via extractLocalizedText
  make: string | null;
  model: string | null;
  modelYear: number | null;
  vehicleType: string | null;
  submittedAt: Date | null;
  requiredTotal: number;
  requiredApproved: number;
};

export async function getVehicleReviewQueue(): Promise<VehicleReviewQueueItem[]> {
  await requireAdmin();

  const requiredTypes = requiredAssetDocumentTypesFor("VEHICLE");

  const assets = await prisma.asset.findMany({
    where: {
      assetType: "VEHICLE",
      OR: [
        // Initial verification review.
        { verificationStatus: "SUBMITTED" },
        // LC5 document re-review: APPROVED vehicle with a pending required document.
        { verificationStatus: "APPROVED", documents: { some: { status: "PENDING", type: { in: requiredTypes } } } },
      ],
    },
    orderBy: { verificationSubmittedAt: "asc" }, // oldest submission first (FIFO review)
    select: {
      id: true,
      verificationStatus: true,
      verificationSubmittedAt: true,
      provider: { select: { businessName: true } },
      vehicle: { select: { make: true, model: true, modelYear: true, vehicleType: true } },
      documents: { select: { type: true, status: true } },
    },
  });

  return assets.map((a) => {
    const byType = new Map(a.documents.map((d) => [d.type, d]));
    const requiredApproved = requiredTypes.filter((type) => byType.get(type)?.status === "APPROVED").length;
    return {
      id: a.id,
      kind: a.verificationStatus === "SUBMITTED" ? "INITIAL" : "REMEDIATION",
      providerName: a.provider.businessName,
      make: a.vehicle?.make ?? null,
      model: a.vehicle?.model ?? null,
      modelYear: a.vehicle?.modelYear ?? null,
      vehicleType: a.vehicle?.vehicleType ?? null,
      submittedAt: a.verificationSubmittedAt,
      requiredTotal: requiredTypes.length,
      requiredApproved,
    };
  });
}
