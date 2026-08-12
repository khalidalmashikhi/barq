# 15 — Data Dictionary

Entity-level detail for every major business entity in BARQ's domain, current and planned. `01-CURRENT-STATE.md` gives the capability-level summary; this file gives the entity-level detail behind it. Where an entity already exists in `prisma/schema.prisma`, its real shape is described; where it doesn't, that's stated plainly rather than guessed at — cross-check against `prisma/schema.prisma` directly before relying on a "current implementation status" claim here for anything you're about to build against.

---

## User

**Purpose:** The root identity — the one thing every person interacting with BARQ has, regardless of what role(s) they later take on.
**Description:** A domain identity record, deliberately separate from Better Auth's own infrastructure-owned `AuthUser` model (ADR-0009). Holds no name/email — those live on `AuthUser` only.
**Relationships:** One-to-one (nullable, unique) with `AuthUser`; one-to-one with `Customer`, `Provider`, `Staff`, `Admin` (a person may hold more than one of these simultaneously in the schema, though `DOMAIN_MODEL.md` Open Question #1 asks whether Customer+Staff should be allowed at the product level).
**Current implementation status:** Real, in production use. UUID v7 primary key per ADR-0006.
**Planned extensions:** None specific to this phase.
**Important business notes:** `User` is the Identity Bounded Context per `DOMAIN_MODEL.md`; `Customer`/`Provider`/`Staff`/`Admin` are separate profile extensions, not subtypes of `User` itself.

## Provider

**Purpose:** A registered business or individual offering services on BARQ.
**Description:** `businessName`/`businessDescription` (bilingual `Json`, `{ar, en}`), `status` (`ProviderStatus`: `APPLIED`/`UNDER_REVIEW`/`APPROVED`/`SUSPENDED`/`DEACTIVATED`), `approvedAt`/`approvedByAdminId`.
**Relationships:** One-to-one with `User`; one-to-many with `Driver`, `Guide`, `Asset`/`Vehicle` (resources it owns), `Service`, `Commission`, `Booking`, `Review`, `SupportTicket`, `Contract`; one-to-one (optional) with `Wallet`.
**Current implementation status:** Real. Onboarding is a 4-field form (business name/description, bilingual). The lifecycle now supports approve (`approveProvider`), reject with a mandatory reason (`rejectProvider` → `REJECTED`, storing `rejectionReason`/`rejectedAt`/`rejectedByAdminId`), self-service resubmit (`resubmitProviderApplication`, `REJECTED → APPLIED`, clears those fields), plus suspend/reactivate/archive. `UNDER_REVIEW` exists but is never entered (no Start Review).
**Planned extensions:** Individual vs. commercial type discriminator; commercial documents (see **Document** below); bank/payout information (see **Settlement** below); logo, website, Google Maps location, opening hours — see `05-PROVIDER-EXPERIENCE.md`.
**Important business notes:** No individual-vs-commercial distinction exists today — see BR-011 in `16-BUSINESS-RULES.md`.

## ProviderProfile

**Purpose:** The professional public-facing page for a provider that a tourist sees.
**Description:** Not a separate entity today — what a tourist actually sees (`ProviderProfileCard`) is assembled directly from `Provider` fields (name, description, status) plus a computed published-services count.
**Relationships:** N/A (folded into `Provider`).
**Current implementation status:** **Does not exist as a distinct entity.** The public provider page is real (`src/app/[locale]/services/[id]/page.tsx`) but reads straight from `Provider`, with no separate "profile" model for logo, gallery images, website, Maps location, or opening hours (none of these fields exist anywhere yet).
**Planned extensions:** Likely becomes a real separate entity once logo/gallery/location/hours are added — whether that's new fields on `Provider` or a genuine `ProviderProfile` model is an open design question (`13-OPEN-QUESTIONS.md`).
**Important business notes:** Every provider and service must have a professional public page (BR-012) — today's page is a correct but minimal start.

## Category

**Purpose:** The top-level business taxonomy tourists browse by (accommodation, transport, restaurants, activities, etc.) and admins configure visibility for.
**Description:** `name` (bilingual `Json`), `slug` (unique string), `visibilityStatus` (`CategoryVisibilityStatus`: `PUBLIC`/`HIDDEN`/`LINK_ONLY`/`INVITE_ONLY`/`SCHEDULED`/`ARCHIVED`, default `HIDDEN`), `scheduledVisibleAt` (nullable, only meaningful when `SCHEDULED`), `sortOrder`.
**Relationships:** Self-referential tree (`parent`/`children`, ADR-0015) plus a live `Service.categoryId` FK (`onDelete: Restrict`). The relational link is **live in the schema** (expand migration `20260805120000_taxonomy_v1_expand`) and **populated by Task B** (2026-08-06): admin + provider service create/edit forms assign a category, and publishing requires one. The **public read path** (homepage/dashboard/browse) still uses the temporary keyword-match filter (see `Service` entry below) — its cutover to `categoryId` is the deferred B2 read-path task. The `SubCategory` relation is a retained, unread shadow (see below).
**Current implementation status:** **Real (Phase 1.1, Core Business Platform)** — schema + migration, admin-gated CRUD + visibility-transition Server Actions (`src/lib/categories/`), audit-logged, tested. Admin UI real (Phase 1.2, `/admin/categories`). Owned by the Marketplace Bounded Context (`ADR-0013`).
**Planned extensions:** `Service.categoryId` assignment is **live** (schema + Task B write path, 2026-08-06); customer-facing Discovery/Search over `categoryId` (Marketplace, deferred B2 read-path task).
**Important business notes:** Foundational — several other planned entities/engines (Business Engine, category-specific provider requirements, CMS homepage sections) depend on this existing first. See `../plans/ROADMAP.md` Phase 1.

## SubCategory

**Purpose:** A finer-grained classification nested under a Category (e.g., "Desert Safari" under "Activities").
**Description:** Same shape as Category (`name`, `slug`, `visibilityStatus`, `scheduledVisibleAt`, `sortOrder`) plus a required `categoryId`.
**Relationships:** Belongs to exactly one `Category`.
**Current implementation status:** **Real (Phase 1.1)** — same implementation as Category (schema, admin-gated actions, tests).
**Planned extensions:** Same as Category (admin UI, then Marketplace browsing).
**Important business notes:** Holds its own `visibilityStatus` independently of its parent — resolved, no longer an open question (see `07-CATEGORIES.md`): effective visibility is always the stricter of the two, via `isSubCategoryEffectivelyVisible()`.

## Service

**Purpose:** A bookable offering a provider publishes (a tour, a rental, a room, etc.).
**Description:** `serviceType` (string CTI discriminator), `name`/`description` (bilingual `Json`), `status` (`ServiceStatus`: `DRAFT`/`PUBLISHED`/`PAUSED`/`ARCHIVED`), `regionCode` (nullable String — the broad Oman **governorate** where the service operates, a discovery/filter facet).
**`regionCode` (Core Service Enrichment, Gate 2 schema + Gate 3 wiring, 2026-08-12):** A stable, language-neutral **governorate** CODE (one of 11 — `MUSCAT`/`DHOFAR`/…; see `src/lib/regions`), never a localized name and never free-text. It is a coarse discovery facet **only** — there is deliberately **no** wilayat/city/map/lat-lng/meeting-point/route/PostGIS geography, and no Vehicle/Asset location. Nullable and NULL-tolerant (legacy rows have none; no backfill). App allow-list `src/lib/regions` mirrors the DB CHECK exactly. Read/written by create/update/duplicate (provider + admin) and exposed by the list/detail/preview readers; **no UI or Explore filter yet** (Gate 4). Gate-2 migration `20260812120000_service_region_pricing_unit` is still UNAPPLIED.
**Relationships:** Belongs to `Provider`; has one-to-one optional `Experience` specialization; one-to-many `Availability`, `Price`, `Booking`.
**Current implementation status:** Real, fully working (Phase 4.2) — create/edit/publish/unpublish/archive/duplicate, all provider-managed. Publishing requires at least one `ACTIVE` `Price`. As of the UX/Navigation Remediation (2026-07-26), homepage/dashboard category cards filter services via a temporary keyword-match against `Service.name` (`getServices()`'s `categoryKeyword`), documented as a bridge pending relational assignment.
**Planned extensions:** `Service.categoryId` assignment is **live** (single nullable FK, ADR-0015; expand migration `20260805120000`; write path shipped in Task B, 2026-08-06 — assignment validated against the service's serviceType + effective category visibility, publish gated by `assertServicePublishable`). No `subCategoryId` — the self-referential `Category` tree replaced the separate sub-category concept. Gallery/image support still absent (no image model on Service today).

**Bulk-operation extension point (design only, not built):** category merges/splits/bulk-reassign/bulk-archive must route through a future `reassignServiceCategories(fromId, toId)` domain op; the `onDelete: Restrict` FK deliberately forces those to be explicit admin migrations rather than silent cascades. **Scalability envelope:** the `CategoryField` picker loads the full selectable tree and filters client-side — correct to ~hundreds of nodes (BARQ today: dozens); past ~1–2k nodes (multi-country × multi-serviceType) switch to the reserved server-side `loadOptions` seam (DTO and component unchanged).
**Important business notes:** `serviceType` must never be treated as a category — see the Category entity above and BR-004's own note.

## Booking

**Purpose:** A customer's reservation against a Service (and optionally a specific `Availability` slot).
**Description:** Rich model — `status` (`BookingStatus`, full lifecycle: `CREATED → PENDING_PROVIDER → CONFIRMED/REJECTED/CANCELLED/EXPIRED → IN_PROGRESS → COMPLETED`, plus `DISPUTED`), `seats`, price/commission snapshots taken at confirmation time.
**Relationships:** Belongs to `Customer`, `Service`, `Provider` (denormalized), optionally `Availability`/`Driver`/`Guide`/`Vehicle`; has one `BookingStatusEvent` history, optional `Journey`, `Payment`, `Invoice`, `Review`, `BookingContract`s.
**Current implementation status:** Real, mature, extensively tested — the single most built-out entity in the system (Phases E.1, 4.1, 4.2, 5.1). Full state machine via `src/lib/booking/lifecycle/`, automatic expiry for stale pending bookings (cron, Phase 5.1).
**Planned extensions:** None specific to this phase — Booking is a Phase 4 concern (Booking Engine) in the new roadmap, already substantially complete.
**Important business notes:** Every status transition is validated centrally (`src/lib/booking/lifecycle/transitions.ts`) and recorded in `BookingStatusEvent` — never write `Booking.status` directly from any new code.

## Pricing

**Purpose:** What a customer pays for a Service.
**Description:** Modeled as `Price` — `amount` (Decimal 12,2), `currency`, `status` (`ACTIVE`/`SUPERSEDED`), `pricingUnit` (nullable String — the display basis of `amount`). Immutable/append-only for the *priced* fields: an `amount` change creates a new row.
**Relationships:** Belongs to `Service`.
**`pricingUnit` (Core Service Enrichment, Gate 2 schema + Gate 3 wiring, 2026-08-12):** **DISPLAY/COMMERCIAL METADATA ONLY** — one of 5 codes (`PER_PERSON`/`PER_BOOKING`/`PER_DAY`/`PER_HOUR`/`PER_TRIP`; see `src/lib/pricing-units`). It labels the basis of `amount` ("per person", "per day") and **does NOT affect totals or booking behaviour**: nothing multiplies by it, `Booking` was not touched, no `priceSnapshotUnit` exists, and `createBooking`/payment/refunds/snapshots are unchanged. It is written onto the same Price row as `amount`/`currency` at create/duplicate, and on update via a metadata-only `updateMany` on the ACTIVE price (never a new Price row, never touching `amount`). The DB has **no** CHECK on it (commercially extensible), so `src/lib/pricing-units` is the *only* allow-list. Every reader reads `pricingUnit` from the *same* ACTIVE Price row as the displayed `amount`. Nullable and NULL-tolerant; no UI yet (Gate 4).
**Current implementation status:** Real, provider-set only. No admin pricing control, no approval step, no request-for-quote flow.
**Planned extensions:** Admin-controlled / provider-controlled / both-with-approval / RFQ modes (BR-005 and `08-PRICING-COMMISSIONS.md`).
**Important business notes:** A `Booking`'s price is snapshotted at confirmation — a later `Price` change never retroactively repriced an existing booking.

## Commission

**Purpose:** BARQ's cut of a booking, owed by the provider.
**Description:** `tier` (`CommissionTier`: `TIER_12`/`TIER_10`/`TIER_8` — fixed percentages only), `status` (`ACTIVE`/`SUPERSEDED`).
**Relationships:** Belongs to `Provider`; referenced by `WalletTransaction`.
**Current implementation status:** Real but minimal — fixed 3-tier percentage only, assigned per-provider (not per-category/subcategory/service).
**Planned extensions:** Percentage / fixed amount / percentage-plus-fixed / zero / manually-agreed models, settable per category/subcategory/service/provider (BR-005, `08-PRICING-COMMISSIONS.md`).
**Important business notes:** Snapshotted onto `Booking` at confirmation, same discipline as Pricing.

## Settlement

**Purpose:** Tracking whether and when a provider has actually been paid out their net earnings.
**Description:** N/A — no dedicated entity exists.
**Relationships:** Would relate to `Provider` (payout destination) and `Payment`/`WalletTransaction` (source of funds).
**Current implementation status:** **Does not exist.** No settlement/transfer-status field anywhere; no bank-account/payout-destination field exists on `Provider` either, so settlement isn't even modelable today.
**Planned extensions:** Full settlement/transfer status tracking as part of the Financial Engine (Phase 5) — likely needs a `ProviderPayoutAccount`-style model given the sensitivity of bank details, per `13-OPEN-QUESTIONS.md`.
**Important business notes:** This is one of the financial fields explicitly required by the product direction (gross/discount/tax/commission/net/paid/outstanding/**settlement status**/**transfer status**) that has zero schema support today.

## Payment

**Purpose:** Tracks the actual money movement for a Booking.
**Description:** `amount`/`currency`, `status` (`PaymentStatus`: `INITIATED`/`CAPTURED`/`REFUNDED_PARTIAL`/`REFUNDED_FULL`/`FAILED`), `refundAmount`, `capturedAt`.
**Relationships:** One-to-one with `Booking`; one-to-one optional `Invoice`; one-to-many `WalletTransaction`, `SupportTicket`.
**Current implementation status:** Real model exists; no discount or tax field.
**Planned extensions:** Discount/tax breakdown fields (see **Settlement** and `08-PRICING-COMMISSIONS.md`).
**Important business notes:** Distinct from **Settlement** — Payment tracks money coming *in* from the customer; Settlement (not yet built) would track money going *out* to the provider.

## Translation

**Purpose:** Making BARQ's interface and content available in all 8 supported languages.
**Description:** Not a database entity today — static JSON files under `messages/{locale}/*.json` (8 locales × 10 namespaces), developer-curated, committed as source code.
**Relationships:** N/A (file-based, not row-based).
**Current implementation status:** Real and mature for **UI strings**. Business-entity content (`Provider.businessName`, `Service.name`, etc.) is already bilingual (`{ar, en}` `Json` fields) but has no AI-assistance or review-state workflow.
**Planned extensions:** AI-assisted translation workflow with review states, specifically for provider-generated business content — not the static UI strings, which stay developer-curated. See `09-TRANSLATION-I18N.md`.
**Important business notes:** Do not conflate the two translation concerns — UI-string translation (ADR-0005/ADR-0010, static, curated) and business-content translation (target: AI-assisted, reviewed) are different systems with different rules.

## SupportTicket

**Purpose:** The record of a customer's (or provider's) request for help — the backbone of the "ساعدني" channel.
**Description:** `status` (`SupportTicketStatus`: `OPENED`/`IN_PROGRESS`/`ESCALATED`/`RESOLVED`/`CLOSED`).
**Relationships:** Relates to `Customer`, `Provider`, `Booking`, `Payment` (for financial-resolution tickets).
**Current implementation status:** **Schema-only.** The model and its status enum exist; zero application code (no create, read, update, or UI) references it anywhere.
**Planned extensions:** The entire feature — creation flow, admin queue, resolution workflow, the "ساعدني" branding/entry point. See `06-TOURIST-EXPERIENCE.md`, `10-COMMUNICATION-POLICY.md`.
**Important business notes:** This is the most "ready to build" schema-only entity — the model shape already looks sound; what's missing is 100% application layer.

## Conversation

**Purpose:** A thread of messages between two parties (e.g., customer and provider), mediated by BARQ.
**Description:** N/A — no model exists.
**Relationships:** Would relate to the two (or more) participating `User`s, and possibly a `Booking` (inquiry context).
**Current implementation status:** **Does not exist.**
**Planned extensions:** Internal Messaging Center (Phase 6). Must enforce BR-002/BR-003 (no direct contact info exposure) by construction — messages route through BARQ, never reveal a counterpart's raw phone/email.
**Important business notes:** See `10-COMMUNICATION-POLICY.md` for the binding policy this entity must satisfy once built.

## Message

**Purpose:** A single message within a Conversation.
**Description:** N/A — no model exists.
**Relationships:** Would belong to a `Conversation`, authored by a `User`.
**Current implementation status:** **Does not exist.** "Contact Provider" today is an honestly-disabled placeholder button with no backing model of any kind.
**Planned extensions:** Paired with Conversation, Phase 6.
**Important business notes:** Same BR-002/BR-003 constraint as Conversation.

## Review

**Purpose:** A customer's post-completion feedback on a Booking/Provider.
**Description:** `Review` (customer's written feedback) + `Rating` (numeric score) as separate related models.
**Relationships:** Belongs to `Customer`, `Provider`, `Booking` (one review per booking); `Rating` belongs to `Review`.
**Current implementation status:** Real, working — wired into Experience Detail pages (Phase 4.1).
**Planned extensions:** None specific to this phase.
**Important business notes:** N/A.

## Notification

**Purpose:** A system-generated message to a user about something that happened (booking status change, provider approval, etc.).
**Description:** `content` (bilingual `Json`), `channel` (`NotificationChannel`: `WHATSAPP`/`EMAIL`/`SMS`), `status` (delivery), `readAt` (in-app read state, distinct from delivery status).
**Relationships:** Belongs to `User`; optionally caused by a `Booking`.
**Current implementation status:** Real, working Notification Center (list/unread-count/mark-read/mark-all-read).
**Planned extensions:** Admin-configurable trigger rules (Notification Engine); an in-app/push channel value doesn't exist in the enum today — only outbound WhatsApp/Email/SMS.
**Important business notes:** One-way (system → user) only — this is not the same entity as Message/Conversation (which are two-way, user ↔ user).

## FeatureFlag

**Purpose:** Toggling a feature on/off per environment or rollout, without a code deploy.
**Description:** N/A — no model exists.
**Relationships:** N/A.
**Current implementation status:** **Does not exist.** Zero matches anywhere in the codebase.
**Planned extensions:** Full Feature Flags engine, Phase 1 per the current roadmap.
**Important business notes:** N/A.

## Campaign

**Purpose:** A time-boxed marketing or promotional effort (e.g., a seasonal discount push).
**Description:** N/A — no model exists.
**Relationships:** N/A.
**Current implementation status:** **Does not exist.** Not mentioned in any current architecture doc as an approved-but-unbuilt concept either — this is a genuinely new concept introduced by this documentation phase's entity list, not previously named anywhere in the repository.
**Planned extensions:** Not yet scoped — no phase in `../plans/ROADMAP.md` currently accounts for it. Flagged in `13-OPEN-QUESTIONS.md`.
**Important business notes:** Needs its own product scoping before it can be assigned to a roadmap phase.

## HomepageSection

**Purpose:** A configurable, orderable block of homepage content (hero, featured experiences, testimonials, etc.).
**Description:** **Corrected 2026-07-27 (Growth Foundations phase) — real database entity, not a target-state aspiration.** `HomepageSection` (`key`, `label`, `description`, `visible`, `sortOrder`) exists in `prisma/schema.prisma`, has full admin CRUD (`/admin/homepage-sections`), and is genuinely read by the public homepage (`src/app/[locale]/page.tsx`) via `getHomepageSectionRenderOrder()`, gated by the `homepage_dynamic_sections` feature flag. Of the 13 registry section keys, 3 (Featured Experiences, Providers, Stats) query real *content* (`Service`/`Provider`/count models) — the rest render static JSX + i18n strings regardless of the flag.
**Relationships:** None today — `visible`/`sortOrder` govern which registry-defined sections render and in what order; the row itself does not reference a `Category`/`Service`/other content row.
**Current implementation status:** **Ordering/visibility is a real, manageable entity with admin CRUD.** Still absent: any way to edit a section's own content (copy/images) from the admin UI, or a generic "section" abstraction that could back an as-yet-unbuilt 14th+ section without new component code.
**Planned extensions:** CMS content editing (copy/images) — the ordering/visibility half of "CMS and Dynamic Homepage" (Phase 1) already shipped; this is the remaining half.
**Important business notes:** N/A.

## Attachment

**Purpose:** A generic file reference (images, PDFs) with metadata, per ADR-0006's "DB stores metadata only, files live in Object Storage" principle.
**Description:** N/A — no generic model exists.
**Relationships:** Would be referenced by whatever entity owns the file (Provider logo, Service gallery image, Document upload).
**Current implementation status:** **Does not exist.** No file/attachment metadata model anywhere, and Object Storage itself is not yet selected/wired up (`TECH_STACK.md` §23 Open Decisions) — so there's currently no working file-upload path in the codebase at all.
**Planned extensions:** Needed by Provider logo/gallery, Service gallery, and Document (commercial registration, etc.) — likely a shared, generic model rather than one-off file fields per entity.
**Important business notes:** Blocked on an Object Storage vendor decision (`TECH_STACK.md`), not just application code.

## ProviderDocument

**Purpose:** A specific, typed provider-submitted verification document (identity evidence, commercial registration, tourism licence) for provider onboarding/verification.
**Description:** `ProviderDocument` — `id`, `providerId`, `type` (registry String), `objectKey` (private storage key), `originalFilename`, `mimeType`, `sizeBytes`, `status` (`ProviderDocumentStatus`), `rejectionReason?`, `reviewedAt?`, `reviewedByAdminId?`, timestamps.
**Relationships:** belongs to `Provider` (`onDelete: Cascade`); optional `reviewedByAdmin` → `Admin` (`onDelete: SetNull`, relation `ProviderDocumentReviewedBy`). Unique `(providerId, type)` (one current doc per type; replace = upsert) and unique `objectKey`.
**Current implementation status:** **End-to-end code-complete (Provider Verification & Documents, Gates 1–3); INERT until a private storage bucket is provisioned.** Gate 1 (schema + registry + requirement resolver + completeness primitive) and Gate 2 (private-storage primitives, magic-byte validation, upload/replace/delete mutations, admin review with RC3 `versionToken` stale protection, authorized 60s signed-URL view) are joined in Gate 3 to the product surfaces: a provider `/[locale]/provider/verification` page (checklist, upload/replace/delete/view), a dashboard readiness card, an admin Verification Documents section (view/approve/reject-with-reason) with a proactive approval-blocker panel, and a `PROVIDER_DOCUMENT_REJECTED` in-app notification (static, 8-locale, never embeds the admin's free-text reason). The approval gate is now wired: `approveProvider` calls `assertProviderApprovable` and refuses with `INCOMPLETE_DOCUMENTS` when a required doc is missing/not `APPROVED` (see **BR-029**). **Grandfathering preserved** — the gate fires only on `APPLIED`/`UNDER_REVIEW` → `APPROVED`; existing APPROVED providers are untouched. The Verified badge is corrected to render only for `status === "APPROVED"` (no more false "Verified" in provider/admin previews). UI degrades gracefully when storage is unconfigured (clear "temporarily unavailable" state, admin review still usable), never falls back to public storage, and never exposes `objectKey` (only the opaque `versionToken`). **Runtime dependency (LAUNCH BLOCKER):** the private bucket (`SUPABASE_DOCS_BUCKET`) is not provisioned, so uploads/views are inert on staging; the Gate-1 migration is not yet applied and the Gate 1/2/3 commits remain local-only.
**Storage note:** the DB stores only the **private** `objectKey` — never a public/permanent/signed URL. The read path (later gate) mints a short-lived signed URL server-side after authorizing the caller; the upload path validates type/size/MIME and writes to a **private** bucket. Bank/settlement data is deliberately out of scope (separate `ProviderPayoutAccount`, still target).

## AuditLog

**Purpose:** An immutable record of who did what to which entity, when, and what changed — for admin/provider mutations that don't already have their own dedicated event-history model.
**Description:** `actorType` (reuses `BookingActorType`), `actorId`, `action` (dot-namespaced string, e.g. `"provider.approved"`), `entityType`/`entityId`, `previousValue`/`newValue` (JSON snapshots), `createdAt`.
**Relationships:** No FK relationships to other domain tables by design (a log, not a source of referential integrity) — mirrors `BookingStatusEvent`'s own precedent.
**Current implementation status:** Real (Phase 5.2). Written atomically, inside the same transaction as the mutation it describes, at exactly 4 mutation types today: provider approval, service publish/unpublish/archive, availability slot create/update/delete/bulk-create. **No UI reads it — write-only.**
**Planned extensions:** An admin-facing viewer; extending write coverage to every new admin-configurable mutation as future engines ship (Category visibility changes, Commission rule changes, etc.) — see `../plans/ROADMAP.md`'s note that Audit Trail extends incrementally alongside every other engine, not as its own standalone phase.
**Important business notes:** Booking status changes are covered by the separate, older `BookingStatusEvent`/`BookingContractEvent` models, not `AuditLog` — the two systems are complementary, not duplicative; `AuditLog` is for everything else.
