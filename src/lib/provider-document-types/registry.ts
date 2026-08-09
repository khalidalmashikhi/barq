// Provider document-type registry — Provider Verification & Documents (Gate 1).
//
// The CODE-OWNED source of truth for the set of provider verification document
// types. Stored on `ProviderDocument.type` as a plain String, validated against
// this registry — deliberately NOT a Prisma enum and NOT a DB CHECK constraint,
// so adding a document type never needs any migration. This mirrors the
// codebase's established convention for governed-extensible identifiers
// (`Category.serviceTypeKey`, `FeatureFlag.key`, `BookingContract.templateKey`,
// `AuditLog.action`) — with one deliberate difference from service-types: no
// Postgres CHECK constraint, so a new document type is a pure code change
// (registry entry + i18n label) with zero schema churn. The single domain write
// path (the upload mutation, a later gate) is the enforcement point: it calls
// isValidProviderDocumentTypeKey() before persisting, exactly as every
// serviceTypeKey write path calls isValidServiceTypeKey().
//
// PRODUCT-LEVEL EVIDENCE CATEGORIES, NOT LEGAL CLAIMS: these keys name the KINDS
// of evidence BARQ may collect from providers (per 03-PRODUCT-REQUIREMENTS.md /
// 05-PROVIDER-EXPERIENCE.md). They are NOT an assertion that Omani law requires
// each one, and which (if any) are *required* is decided separately in
// requirements.ts (code-controlled), never hardcoded as a legal fact here.
//
// Intentionally isomorphic (no `server-only`): pure data consumed by both
// server domain code (validation) and future server-rendered UI (the type
// select / checklist). Adding a document type = one entry here + one i18n label.

export const PROVIDER_DOCUMENT_TYPE_KEYS = [
  "IDENTITY_PROOF",
  "COMMERCIAL_REGISTRATION",
  "TOURISM_LICENCE",
] as const;

export type ProviderDocumentTypeKey = (typeof PROVIDER_DOCUMENT_TYPE_KEYS)[number];

// i18n label key per document type. Presentation metadata only — never
// behavior. `as const satisfies` preserves the literal label-key types so
// next-intl's t() accepts PROVIDER_DOCUMENT_TYPE_LABEL_KEYS[key] as a real
// message key. The actual translations (8 locales) are added in the later
// UX gate, alongside the surfaces that render them.
export const PROVIDER_DOCUMENT_TYPE_LABEL_KEYS = {
  IDENTITY_PROOF: "documentTypeIdentityProof",
  COMMERCIAL_REGISTRATION: "documentTypeCommercialRegistration",
  TOURISM_LICENCE: "documentTypeTourismLicence",
} as const satisfies Record<ProviderDocumentTypeKey, string>;

// Runtime guard: is `value` one of the governed document-type keys? Used by
// every write path that accepts a document type, so an invalid arbitrary string
// can never reach `ProviderDocument.type` (there is no DB CHECK — this validator
// IS the guard).
export function isValidProviderDocumentTypeKey(value: unknown): value is ProviderDocumentTypeKey {
  return typeof value === "string" && (PROVIDER_DOCUMENT_TYPE_KEYS as readonly string[]).includes(value);
}
