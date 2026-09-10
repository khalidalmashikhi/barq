import type { ProviderDocumentTypeKey } from "./registry";

// ADR-0017 — the DEFAULT provider verification policy (Level 2). This is the
// SINGLE source of the three default requirements, used by BOTH:
//   1. the staging bootstrap (verification-requirement-bootstrap.ts) — the rows
//      it insert-if-absent seeds, and
//   2. the fail-closed fallback — when the ProviderVerificationRequirement table
//      is unreadable (DB error) or unseeded (empty), the runtime resolvers fall
//      back to THIS set (never "require nothing"), so behaviour is byte-identical
//      to the pre-Level-2 hard-coded map even before/without a seed.
//
// Keeping one source guarantees the seeded rows and the fail-closed fallback can
// never drift apart. The `required`/`appliesTo` values here MUST agree with
// requirements.ts's REQUIRED_BY_PROVIDER_TYPE (guarded by a consistency test):
//   IDENTITY_PROOF          → INDIVIDUAL → required
//   COMMERCIAL_REGISTRATION → COMPANY    → required
//   TOURISM_LICENCE         → BOTH       → optional
// An INDIVIDUAL is therefore never required to provide Commercial Registration
// unless an admin later changes the policy.
//
// Isomorphic (no server-only): pure data. Bilingual name/description follow the
// { ar, en } JSON convention (ADR-0005); they are presentation only.

// INDIVIDUAL/COMPANY/BOTH are the provider business-FORM audiences (matched against
// Provider.providerType). TOURIST_GUIDE/RENTAL_COMPANY are the provider-VERTICAL audiences (Phase
// 3B Phase 1), a distinct dimension resolved only by the vertical-approval gate. The values are
// disjoint so the two resolvers never overlap — see prisma enum VerificationRequirementAudience.
export type VerificationRequirementAudience = "INDIVIDUAL" | "COMPANY" | "BOTH" | "TOURIST_GUIDE" | "RENTAL_COMPANY";

export type DefaultVerificationRequirement = {
  key: ProviderDocumentTypeKey;
  appliesTo: VerificationRequirementAudience;
  required: boolean;
  active: boolean;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  sortOrder: number;
  // Phase 3B Phase 1 — does this requirement's evidence carry an expiry that must stay valid?
  // Omitted → false (non-expiring). Only the vertical requirements below opt in.
  evidenceExpires?: boolean;
};

export const DEFAULT_VERIFICATION_REQUIREMENTS: readonly DefaultVerificationRequirement[] = [
  {
    key: "IDENTITY_PROOF",
    appliesTo: "INDIVIDUAL",
    required: true,
    active: true,
    name: { ar: "إثبات الهوية", en: "Identity Proof" },
    // Gate 0 product policy: the accepted primary identity evidence for an
    // INDIVIDUAL is a VALID Civil / National ID card only — passport is NOT
    // accepted (the former "national ID or passport" wording is removed). The
    // server-side accepted document-TYPE rules are unchanged; this is the
    // provider-facing description text. (Expiry/OCR automation is a later gate.)
    description: {
      ar: "نسخة واضحة من البطاقة الشخصية / المدنية سارية الصلاحية.",
      en: "A clear copy of your valid Civil / National ID card.",
    },
    sortOrder: 0,
  },
  {
    key: "COMMERCIAL_REGISTRATION",
    appliesTo: "COMPANY",
    required: true,
    active: true,
    name: { ar: "السجل التجاري", en: "Commercial Registration" },
    description: {
      ar: "نسخة سارية من السجل التجاري الخاص بالشركة.",
      en: "A valid copy of the company's commercial registration.",
    },
    sortOrder: 1,
  },
  {
    key: "TOURISM_LICENCE",
    appliesTo: "BOTH",
    required: false,
    active: true,
    name: { ar: "الترخيص السياحي", en: "Tourism Licence" },
    description: {
      ar: "ترخيص مزاولة النشاط السياحي، إن وُجد (اختياري).",
      en: "A tourism activity licence, if applicable (optional).",
    },
    sortOrder: 2,
  },
] as const;

// Phase 3B — Phase 1. The MINIMUM provider-VERTICAL verification policy. Kept SEPARATE from
// DEFAULT_VERIFICATION_REQUIREMENTS on purpose: the vertical policy is NEVER a fail-closed code
// fallback (an unseeded vertical fails closed → VERTICAL_POLICY_NOT_CONFIGURED, it is not silently
// satisfied), and it must never leak into the provider-type (INDIVIDUAL/COMPANY/BOTH) resolvers.
// These are seeded ONLY via the vertical requirement bootstrap (insert-if-absent, never overwriting
// an admin-edited row). General individual/company requirements (identity, commercial registration)
// remain governed by the existing provider-approval system and are deliberately NOT duplicated here.
// Every requirement's evidence expires (licences / registrations lapse), so approval requires a
// future ProviderDocument.expiresAt for each.
export const VERTICAL_VERIFICATION_REQUIREMENTS: readonly DefaultVerificationRequirement[] = [
  {
    key: "RENTAL_ACTIVITY_LICENCE",
    appliesTo: "RENTAL_COMPANY",
    required: true,
    active: true,
    evidenceExpires: true,
    name: { ar: "رخصة نشاط تأجير المركبات", en: "Vehicle-Rental Activity Licence" },
    description: {
      ar: "رخصة سارية لمزاولة نشاط تأجير المركبات.",
      en: "A valid licence to operate a vehicle-rental activity.",
    },
    sortOrder: 0,
  },
  {
    key: "RENTAL_BUSINESS_REGISTRATION",
    appliesTo: "RENTAL_COMPANY",
    required: true,
    active: true,
    evidenceExpires: true,
    name: { ar: "السجل التجاري لنشاط التأجير", en: "Rental Business Registration" },
    description: {
      ar: "سجل تجاري ساري يثبت تسجيل نشاط تأجير المركبات.",
      en: "A valid commercial/business registration covering the vehicle-rental activity.",
    },
    sortOrder: 1,
  },
  {
    key: "TOURIST_GUIDE_LICENCE",
    appliesTo: "TOURIST_GUIDE",
    required: true,
    active: true,
    evidenceExpires: true,
    name: { ar: "رخصة المرشد السياحي", en: "Tourist-Guide Licence" },
    description: {
      ar: "رخصة أو اعتماد ساري لمزاولة نشاط الإرشاد السياحي.",
      en: "A valid tourist-guide licence or approved guide credential.",
    },
    sortOrder: 0,
  },
] as const;
