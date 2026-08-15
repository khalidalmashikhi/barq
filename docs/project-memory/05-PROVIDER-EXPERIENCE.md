# 05 — Provider Experience

## Current state

- **Onboarding**: a single 4-field form (`src/app/[locale]/provider-application/page.tsx` → `src/lib/provider/apply-as-provider.ts`) — `businessNameAr`/`businessNameEn` (required), `businessDescriptionAr`/`businessDescriptionEn` (optional). **(Corrected 2026-08-14, Provider Gate PA audit:)** a `ProviderDocument` model + `ProviderVerificationRequirement` policy (ADR-0017) + a `/provider/verification` document-upload flow + admin review now exist — the earlier "no license/document/KYC field exists anywhere in the schema" claim is superseded.
- **Approval / rejection lifecycle** (Provider Review/Reject/Resubmit): admin actions `approveProvider` and `rejectProvider` (mandatory reason, stored on `Provider.rejectionReason`/`rejectedAt`/`rejectedByAdminId` and in the `provider.rejected` audit payload). A rejected applicant self-serves `resubmitProviderApplication` (`REJECTED → APPLIED`, back into the review queue; clears the rejection fields — audit history is retained). `suspendProvider`/`reactivateProvider`/`archiveProvider` also exist. `ProviderStatus` now has `REJECTED`; `UNDER_REVIEW` remains a valid enum value and an approvable/rejectable input, but nothing transitions *into* it (no Start Review). A rejected provider keeps APPLIED-like access (can edit profile/media and preview via `requireProvider`; `requireApprovedProvider` still blocks service/availability/booking management) and full customer access.
- **Individual-vs-commercial distinction now EXISTS (corrected 2026-08-14, Provider Gate PA audit)** — `ProviderType` enum (`INDIVIDUAL`/`COMPANY`, default `COMPANY`) + `Provider.providerType`, chosen on the onboarding form. (Supersedes the earlier "one `Provider` model, no type/kind discriminator" claim.) It remains a presentation/wording discriminator — it never forks auth, dashboards, services, or bookings.
- **Resources a provider can register**: `Driver`, `Guide`, `Asset`/`Vehicle` — these are inventory a Provider owns, not alternate provider types or onboarding paths. A single Provider can hold any combination.
- **Public provider page**: `src/app/[locale]/services/[id]/page.tsx` renders a `ProviderProfileCard` (name, description, status, published-services count) — no phone/email/WhatsApp is ever fetched or displayed. "Contact Provider" renders as an honestly-disabled button (see `10-COMMUNICATION-POLICY.md`).
- **Services/pricing management**: providers create/edit/publish/archive their own `Service` rows and set `Price` — this is real and working (Phase 4.2), but categories don't exist to organize it, and pricing has no admin approval step.
- **Native provider API surface (Gate PC, added 2026-08-15 — LOCAL commit `6520000`, NOT pushed/deployed, VERIFIED BY TEST ONLY):** the provider write operations are now also exposed as thin `/api/v1/me/provider/**` JSON adapters for the native iOS client (ADR-0018) — profile `PATCH`; service `POST`/`PATCH`/`publish`/`unpublish`; availability `POST`/`PATCH`/`DELETE`; booking `accept`/`reject`/`start`/`complete`. They are adapters over the *same* Server Actions the web uses (no new business logic, no new capability), reuse the Better Auth cookie session, keep ownership at the domain boundary (no client `providerId`, uniform-404 for not-owned), and never return raw Prisma objects. **Deferred within Gate PC:** standalone price mutation (no provider price-edit domain exists — price stays bundled into service creation), verification-document upload, provider media, and provider application/resubmission. See `01-CURRENT-STATE.md` (§ADR-0011 API surface) and `12-DECISIONS.md`.

## Target state

- **Individual vs. commercial onboarding**, with different required fields per type.
- **Commercial providers may submit**: commercial registration, municipal licence, tenancy agreement, bank account information, logo, images, website, Google Maps location, opening hours, and contact details.
- **Category-specific requirements**, configurable by an admin (depends on Dynamic Category Management existing first — see `../plans/ROADMAP.md`).
- **Every provider and service has a professional public page** — today's page is a real start (name/description/status/count) but has no room yet for logo, images, website, Maps location, opening hours, or category-specific trust signals.
- **Full onboarding review workflow**: reject/resubmit, suspend, deactivate, re-approve are now implemented. Still target: review assignment/ownership, multi-reviewer workflow, KYC/document verification, review SLA, rejection templates, and an appeal workflow.

## What must not change

Direct phone/WhatsApp/email exposure to tourists must never be added to any future provider-page redesign — this is a permanent product rule (`10-COMMUNICATION-POLICY.md`, BR-002), not an accidental omission to "fix."

## Related registry entries

BR-001 (approval gates publishing — **now enforced** via `requireApprovedProvider()`, corrected 2026-08-14), BR-011 (individual/commercial split — `ProviderType` now present), BR-012 (professional public page) in `16-BUSINESS-RULES.md`; `Provider`, `ProviderProfile`, `Document` entities in `15-DATA-DICTIONARY.md`.
