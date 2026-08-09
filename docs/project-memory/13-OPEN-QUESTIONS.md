# 13 — Open Questions

Explicitly unresolved items. Check this file before assuming an answer to any of these — if a task touches one of them, surface the question rather than silently picking an answer.

## Naming

- **"برق" vs. "بارق"**: `messages/ar/common.json`'s `appName` correctly uses "برق". `messages/ar/landing.json` incorrectly uses "بارق" in 13 places (headings, FAQ answers, CTAs, "How it works," "Why choose," stats, testimonials, CTA section, about-link). Needs a dedicated content-correction pass across all 8 locales' landing/marketing copy (check other locale files too — only `ar` was checked during this phase). Not fixed in this phase (documentation/memory scaffolding only).

## Architecture

- **ADR-0009 status**: still "Draft v0.1 — Architecture Review pending" in its own document header, even though the schema already implements the `AuthUser`/`User` separation it describes, and reconciliation-order / phone-collision Open Questions within that ADR (lines 71-73) remain unresolved. Should this ADR be formally reviewed and Locked, given the implementation has outpaced its own approval status?
- **ADR-0011 versioning gap**: mandates `/api/v1/...`-style versioned public APIs; the real API surface (`src/app/api/`) has zero versioning today. Does closing this gap retroactively version existing routes, or only apply going forward to new engine APIs?
- **DOMAIN_MODEL.md Open Question #1**: can one person hold both Customer and Staff roles simultaneously? This directly feeds ADR-0009's own phone-number-identity-collision question. Unresolved.

## Category model design

- ~~Does Category deserve its own Bounded Context...~~ **Resolved (Phase 1.1):** yes — Marketplace is Bounded Context #16, per `ADR-0013`. See `07-CATEGORIES.md`.
- **~~How should `Service` relate to `Category`/`SubCategory`?~~ RESOLVED (2026-08-06).** ADR-0015 froze a single nullable `Service.categoryId` FK (no `subCategoryId` — the self-referential `Category` tree replaced sub-categories); the expand migration `20260805120000` made it live, and **Task B shipped the write path** (admin + provider assignment, serviceType-scoped effective-visibility validation, publish-time category requirement via `assertServicePublishable`). The keyword-match bridge in `get-services.ts` remains a documented temporary stand-in **only for the public read path** (browse/search/homepage), whose cutover to `categoryId` is the deferred B2 task. See `07-CATEGORIES.md`, `ADR-0015`.
- How does a future `Category` model relate to `Service.serviceType`'s existing plain-string CTI discriminator — does `serviceType` become category-scoped, get replaced, or stay fully independent? `ADR-0014` assumes independent (proposed, not fully closed — see that ADR's Open Question #2).
- Category-specific provider requirements (documents, forms) imply category-aware form definitions — does this require Form Builder (engine #3) to exist first, or can category requirements be modeled more simply as a first cut?

## Provider model design

- Individual vs. commercial onboarding: new field(s) on `Provider`, or a new discriminated type/subtype model (mirroring the existing `Asset`/`Vehicle` Class-Table-Inheritance pattern)?
- ~~Where do commercial documents (registration, municipal licence, tenancy agreement) live — new fields, or a new `ProviderDocument` model?~~ **Resolved (Provider Verification & Documents, Gate 1):** a new `ProviderDocument` model. `type` is a registry-validated **String** (code registry `src/lib/provider-document-types`, mirroring `Category.serviceTypeKey`) — **not** a Prisma enum, **not** a DB catalog, so adding a document type needs no migration. Requirement rules are **code-controlled** (`requiredDocumentTypesFor`, keyed by `ProviderType` only — public `Category` never controls compliance). Documents are **private** artifacts: the DB stores only the private-bucket `objectKey`, never a public/signed URL. `ProviderDocumentStatus` (PENDING/APPROVED/REJECTED) is a per-document review lifecycle. Private-bucket storage + signed-URL read path remain to be built (later gate) and require ops provisioning.
- Bank account information for settlement — new `ProviderPayoutAccount` model, or fields directly on `Provider`? Security implications (this is sensitive financial data) favor a separate, more tightly-scoped model.

## Financial model design

- Does discount/tax tracking belong on `Booking`, `Payment`, or a new line-item model?
- What does "settlement status" actually mean operationally for BARQ — is there a real payout-processing integration planned, or is this initially just a status field an admin sets manually?

## Translation workflow design

- Review-state granularity for AI-assisted provider-content translation: per-field flag, or a fuller versioned-translation-history model?
- Does the AI-assisted workflow extend to all 8 locales for provider content, or stay bilingual (ar/en) like today's `Provider.businessName`/`Service.name` shape?

## Sequencing

- See `../plans/ROADMAP.md` for the proposed engine ordering — is Dynamic Category Management really the correct first engine to build, or does Provider Onboarding's individual/commercial split need to land first since category-specific *provider* requirements depend on both existing?

## Newly surfaced (documentation phase 2)

- **`Campaign`** (marketing/promotional entity, see `15-DATA-DICTIONARY.md`) has no current schema, no mention in any existing architecture doc, and no assigned roadmap phase. Needs its own product scoping before it can be placed anywhere in `../plans/ROADMAP.md`.
- **BR-001 enforcement gap, verified real**: `requireProvider()` (`src/lib/auth/rbac.ts`) does not check `Provider.status === "APPROVED"` — a provider in `APPLIED`/`UNDER_REVIEW` can create, edit, and publish services today. Is this an accepted MVP gap, or should it be closed in a small, targeted fix ahead of any larger engine work? This is a real, code-verified finding, not a hypothetical.
