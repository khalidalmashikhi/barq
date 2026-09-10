-- Phase 3B — Phase 1: seed the BASELINE verification-requirement policy (migration 54).
--
-- WHY A SEPARATE MIGRATION (not folded into 53): migration 53 ADDs the two new
-- VerificationRequirementAudience enum values (TOURIST_GUIDE, RENTAL_COMPANY). PostgreSQL forbids
-- USING a newly added enum value in the SAME transaction it was added ("unsafe use of new value").
-- `prisma migrate deploy` applies each migration file as its own step/transaction, so these INSERTs
-- — which reference the new audiences — MUST live in a migration that runs AFTER 53 has committed.
-- This is that migration.
--
-- WHY IT SEEDS THE PROVIDER-TYPE ROWS TOO (not only the vertical rows): the runtime resolver
-- (resolveRequiredKeysFromPolicy) falls back to the code-default required set ONLY when the
-- requirements table is EMPTY/unreadable. Seeding vertical rows makes the table non-empty, which
-- switches the provider-TYPE resolver to the authoritative policy — so if the provider-type rows
-- were absent, INDIVIDUAL/COMPANY approval would suddenly require zero documents. Seeding the full
-- baseline (the three provider-type defaults + the three vertical requirements) guarantees both
-- policies and preserves existing provider-type approval behavior exactly.
--
-- SAFETY: `ON CONFLICT ("key") DO NOTHING` — idempotent (re-execution is a no-op) and it NEVER
-- overwrites an administrator-edited row (an existing key is left exactly as-is). Purely additive:
-- no UPDATE, no DELETE, no schema change. The values mirror the single code source
-- (src/lib/provider-document-types/default-requirements.ts: DEFAULT_ + VERTICAL_VERIFICATION_REQUIREMENTS);
-- the runtime bootstrap scripts remain a verification/repair utility, not the sole seeding mechanism.
-- gen_random_uuid() (PostgreSQL 13+ built-in) supplies the id; the value is irrelevant to behavior.

INSERT INTO "provider_verification_requirements"
  ("id", "key", "name", "description", "appliesTo", "required", "evidenceExpires", "active", "sortOrder", "createdAt", "updatedAt")
VALUES
  -- Provider business-form baseline (unchanged from the pre-existing default policy).
  (gen_random_uuid(), 'IDENTITY_PROOF',
   '{"ar":"إثبات الهوية","en":"Identity Proof"}'::jsonb,
   '{"ar":"نسخة واضحة من البطاقة الشخصية / المدنية سارية الصلاحية.","en":"A clear copy of your valid Civil / National ID card."}'::jsonb,
   'INDIVIDUAL'::"VerificationRequirementAudience", true, false, true, 0, now(), now()),
  (gen_random_uuid(), 'COMMERCIAL_REGISTRATION',
   '{"ar":"السجل التجاري","en":"Commercial Registration"}'::jsonb,
   '{"ar":"نسخة سارية من السجل التجاري الخاص بالشركة.","en":"A valid copy of the company''s commercial registration."}'::jsonb,
   'COMPANY'::"VerificationRequirementAudience", true, false, true, 1, now(), now()),
  (gen_random_uuid(), 'TOURISM_LICENCE',
   '{"ar":"الترخيص السياحي","en":"Tourism Licence"}'::jsonb,
   '{"ar":"ترخيص مزاولة النشاط السياحي، إن وُجد (اختياري).","en":"A tourism activity licence, if applicable (optional)."}'::jsonb,
   'BOTH'::"VerificationRequirementAudience", false, false, true, 2, now(), now()),
  -- Provider-VERTICAL minimum policy (Phase 3B Phase 1) — required + evidence-expiring.
  (gen_random_uuid(), 'RENTAL_ACTIVITY_LICENCE',
   '{"ar":"رخصة نشاط تأجير المركبات","en":"Vehicle-Rental Activity Licence"}'::jsonb,
   '{"ar":"رخصة سارية لمزاولة نشاط تأجير المركبات.","en":"A valid licence to operate a vehicle-rental activity."}'::jsonb,
   'RENTAL_COMPANY'::"VerificationRequirementAudience", true, true, true, 0, now(), now()),
  (gen_random_uuid(), 'RENTAL_BUSINESS_REGISTRATION',
   '{"ar":"السجل التجاري لنشاط التأجير","en":"Rental Business Registration"}'::jsonb,
   '{"ar":"سجل تجاري ساري يثبت تسجيل نشاط تأجير المركبات.","en":"A valid commercial/business registration covering the vehicle-rental activity."}'::jsonb,
   'RENTAL_COMPANY'::"VerificationRequirementAudience", true, true, true, 1, now(), now()),
  (gen_random_uuid(), 'TOURIST_GUIDE_LICENCE',
   '{"ar":"رخصة المرشد السياحي","en":"Tourist-Guide Licence"}'::jsonb,
   '{"ar":"رخصة أو اعتماد ساري لمزاولة نشاط الإرشاد السياحي.","en":"A valid tourist-guide licence or approved guide credential."}'::jsonb,
   'TOURIST_GUIDE'::"VerificationRequirementAudience", true, true, true, 0, now(), now())
ON CONFLICT ("key") DO NOTHING;
