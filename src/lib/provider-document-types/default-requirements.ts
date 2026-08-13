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

export type VerificationRequirementAudience = "INDIVIDUAL" | "COMPANY" | "BOTH";

export type DefaultVerificationRequirement = {
  key: ProviderDocumentTypeKey;
  appliesTo: VerificationRequirementAudience;
  required: boolean;
  active: boolean;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  sortOrder: number;
};

export const DEFAULT_VERIFICATION_REQUIREMENTS: readonly DefaultVerificationRequirement[] = [
  {
    key: "IDENTITY_PROOF",
    appliesTo: "INDIVIDUAL",
    required: true,
    active: true,
    name: { ar: "إثبات الهوية", en: "Identity Proof" },
    description: {
      ar: "صورة واضحة من بطاقة الهوية الوطنية أو جواز السفر لمقدم الخدمة الفرد.",
      en: "A clear copy of the individual provider's national ID or passport.",
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
