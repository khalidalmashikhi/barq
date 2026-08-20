import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";

// VEHICLE-LC3 — the admin review QUEUE read model: vehicles awaiting an admin
// verification decision. requireAdmin()-gated. Only SUBMITTED vehicles appear in
// the active queue (DRAFT is provider work-in-progress and never surfaces; the
// terminal/returned states CHANGES_REQUESTED / REJECTED / APPROVED are provider- or
// history-owned, not an admin to-do). Returns only UI-safe fields — never a raw
// Prisma row, never an objectKey.

export type VehicleReviewQueueItem = {
  id: string; // assetId
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
    where: { assetType: "VEHICLE", verificationStatus: "SUBMITTED" },
    orderBy: { verificationSubmittedAt: "asc" }, // oldest submission first (FIFO review)
    select: {
      id: true,
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
