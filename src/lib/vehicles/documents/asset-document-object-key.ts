// VEHICLE-LC2 — private object-key layout for asset (vehicle) documents. Mirrors
// buildDocumentObjectKey's convention but under an asset-scoped prefix:
// `asset-documents/{assetId}/{type}/{uuid}.{ext}`. The key NEVER contains the
// user's filename (path-traversal safety); the `unique` uuid is injected by the
// caller so this stays pure/testable. Reuses sanitizeOriginalFilename for the
// stored display filename.

export { sanitizeOriginalFilename } from "@/lib/provider/documents/document-object-key";

export function buildAssetDocumentObjectKey(params: {
  assetId: string;
  type: string;
  ext: string;
  unique: string;
}): string {
  return `asset-documents/${params.assetId}/${params.type.toLowerCase()}/${params.unique}.${params.ext}`;
}
