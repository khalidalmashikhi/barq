import "server-only";
import { prisma } from "@/lib/db";
import { createSignedObjectUrl, isDocumentStorageConfigured } from "@/lib/storage/storage";
import { sanitizeOriginalFilename } from "./asset-document-object-key";

// VEHICLE-LC2 — authorized short-lived signed-URL minting for an AssetDocument,
// mirroring getProviderDocumentSignedUrl. Ownership is inherited via
// AssetDocument → Asset → Provider: a provider may view ONLY a document on a
// vehicle they own; an admin may view any. Returns null for missing / not-owned /
// storage-not-configured so the transport responds with a UNIFORM 404 that never
// reveals a document's existence. The raw objectKey is never returned; the signed
// URL is never persisted.

export const VEHICLE_DOC_SIGNED_URL_TTL_SECONDS = 60;

export type VehicleDocumentCaller = { kind: "provider"; providerId: string } | { kind: "admin" };

export type SignedVehicleDocumentView = { signedUrl: string; filename: string };

export async function getVehicleDocumentSignedUrl(
  vehicleId: string,
  documentId: string,
  caller: VehicleDocumentCaller,
): Promise<SignedVehicleDocumentView | null> {
  // Path-binding: the document must belong to the vehicle NAMED IN THE URL
  // (assetId === vehicleId), so a caller cannot view one vehicle's document through
  // another vehicle's URL. Combined with the provider-ownership check below, every
  // failure mode (missing / not-owned / mismatched / storage off) returns null → a
  // single uniform 404 that never reveals whether a document exists.
  const doc = await prisma.assetDocument.findFirst({
    where: { id: documentId, assetId: vehicleId },
    select: { objectKey: true, originalFilename: true, asset: { select: { providerId: true } } },
  });
  if (!doc) return null;
  if (caller.kind === "provider" && doc.asset.providerId !== caller.providerId) return null;
  if (!isDocumentStorageConfigured()) return null;

  const filename = sanitizeOriginalFilename(doc.originalFilename);
  const signedUrl = await createSignedObjectUrl(doc.objectKey, VEHICLE_DOC_SIGNED_URL_TTL_SECONDS, { downloadFilename: filename });
  return { signedUrl, filename };
}
