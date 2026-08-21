import type { AssetType } from "@prisma/client";

// VEHICLE-LC1 — the CODE-OWNED registry of asset verification document types,
// stored on AssetDocument.type as a plain String (validated here, not a Prisma
// enum / DB CHECK), so adding a type is a pure code change — same convention as
// src/lib/provider-document-types/registry.ts and Category.serviceTypeKey.
//
// PRODUCT-LEVEL EVIDENCE CATEGORIES, NOT LEGAL CLAIMS: these keys name the KINDS
// of evidence BARQ may collect for a vehicle. They are NOT an assertion that Omani
// law requires any of them; which are REQUIRED is a BARQ product decision below
// (code-controlled for LC1; admin-configurable persistence is deferred to a later
// gate). Any legally-mandated set needs external legal review.
//
// Isomorphic (no server-only): pure data for domain validation + future UI.

export const ASSET_DOCUMENT_TYPE_KEYS = ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"] as const;

export type AssetDocumentTypeKey = (typeof ASSET_DOCUMENT_TYPE_KEYS)[number];

// i18n label key per type — presentation only; translations added with the LC2 UI.
export const ASSET_DOCUMENT_TYPE_LABEL_KEYS = {
  VEHICLE_REGISTRATION: "assetDocumentTypeVehicleRegistration",
  VEHICLE_INSURANCE: "assetDocumentTypeVehicleInsurance",
} as const satisfies Record<AssetDocumentTypeKey, string>;

// Literal union of the label keys, so callers can pass it straight to the strict
// next-intl translator (a widened `string` would be rejected).
export type AssetDocumentLabelKey = (typeof ASSET_DOCUMENT_TYPE_LABEL_KEYS)[AssetDocumentTypeKey];

export function isValidAssetDocumentTypeKey(value: unknown): value is AssetDocumentTypeKey {
  return typeof value === "string" && (ASSET_DOCUMENT_TYPE_KEYS as readonly string[]).includes(value);
}

// BARQ product policy: which document types are REQUIRED before an asset may be
// approved/selectable, by AssetType. Deterministic, no I/O. LC1 keeps this
// code-owned; a later gate may layer admin-configurable requirements (ADR-0017
// style) and activity-specific rules on top WITHOUT changing this contract.
const REQUIRED_BY_ASSET_TYPE: Record<AssetType, readonly AssetDocumentTypeKey[]> = {
  VEHICLE: ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"],
};

export function requiredAssetDocumentTypesFor(assetType: AssetType): AssetDocumentTypeKey[] {
  return [...(REQUIRED_BY_ASSET_TYPE[assetType] ?? [])];
}

// VEHICLE-LC6 — the CODE-OWNED policy for which document types carry a meaningful
// EXPIRY date (a provider may claim one; an admin confirms it into the trusted
// AssetDocument.expiresAt at approval). Centralized here — the single place the UI,
// routes, provider claim, and admin confirmation consult — so the "does this type
// expire?" decision is never scattered as ad-hoc per-type checks. A type NOT in this
// set never captures or requires an expiry (its trusted expiresAt stays null).
// Registration and insurance both lapse in Oman; both expire.
const EXPIRING_ASSET_DOCUMENT_TYPES = new Set<AssetDocumentTypeKey>(["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"]);

export function assetDocumentTypeSupportsExpiry(type: string): boolean {
  return isValidAssetDocumentTypeKey(type) && EXPIRING_ASSET_DOCUMENT_TYPES.has(type);
}
