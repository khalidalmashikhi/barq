# BARQ i18n Message Conventions

- **Purpose:** Concise, implementation-focused conventions for authoring and organizing next-intl translation messages — how keys are named, namespaced, nested, and pluralized. This document does not redefine any architectural decision; it operationalizes `LOCALIZATION.md` and ADR-0010 into daily practice for whoever is actually writing translation keys, the same relationship `ENGINEERING_GUIDE.md` has to `PROJECT_RULES.md`.
- **Scope:** Locale codes, namespace set and ownership, folder structure, key naming, nesting depth, ICU syntax conventions, prohibited patterns, canonical key-shape rule, missing-key behavior, and mobile/API reuse boundaries.
- **Out of Scope:** The architectural decisions themselves (`ADR-0005`, `ADR-0010`, `LOCALIZATION.md` — referenced, not restated or reopened), the i18n library choice and infrastructure (`src/i18n/`, `src/middleware.ts` — Phase 0 of the internationalization implementation), actual translated copy for any of the 8 locales, hreflang/SEO/sitemap conventions (later-phase work).
- **Placement note:** No `docs/04-engineering/` directory exists in this repository's documentation taxonomy. This document lives in `docs/04-experience/`, alongside `LOCALIZATION.md`, `DESIGN_SYSTEM.md`, and `ACCESSIBILITY.md` — the existing home for design/localization/accessibility architecture per `BARQ_BIBLE.md`'s Documentation Map. This document is the implementation-conventions companion to `LOCALIZATION.md`, the same relationship `ENGINEERING_GUIDE.md` has to `PROJECT_RULES.md`.
- **Status:** Draft v1.0 — introduced as part of Internationalization Phase 0.5 (Architecture Hardening). Not an ADR; does not supersede or modify `ADR-0010`/`ADR-0011`.
- **Owner:** Whoever owns the internationalization implementation (currently the engineering conversation driving this migration).

---

## 1. Approved Locale Codes

Per `ADR-0010` and `src/i18n/locales.ts` (the single runtime source of truth — never re-declare this list anywhere else):

`ar`, `en`, `de`, `it`, `pl`, `fr`, `cs`, `ru`

Arabic (`ar`) is the default and RTL; all seven others are LTR.

## 2. Current Namespace Set

`common`, `auth`, `booking`, `services`, `provider`, `dashboard`, `errors`, `seo` — mirrored in `src/i18n/namespaces.ts`.

## 3. Folder Structure

```
messages/{locale}/{namespace}.json
```

Example: `messages/de/booking.json`. One file per locale per namespace — never one giant file per locale, never one file shared across locales.

## 4. Namespace Ownership Rules

- Namespaces are **domain-oriented** (`booking`, `services`, `provider`), mirroring the same Bounded-Context-per-folder convention already used under `src/lib/` — not page-oriented.
- **Do not create page-specific namespaces** (e.g. no `bookingDetailPage`, no `serviceCard`) — a namespace owns a domain concept, not a route.
- **Do not create role-specific duplicates** of a namespace that already owns the text. If a string is genuinely identical in meaning for both a Customer and a Provider (e.g. a generic "Cancel" button), it belongs in `common`, not copied into both a customer-facing and a `provider` namespace.
- **Add a namespace only when a real bounded-context need exists** — the same threshold this codebase already applies to extracting shared code (see `getOmanTodayRangeUtc()`/`OMAN_TIME_ZONE`'s "extract at 3+ real consumers" precedent): don't pre-create a namespace for a domain that has no messages yet.

## 5. Key Naming Rules

- **Stable, semantic names** — a key names *what the text means*, not where it currently sits on screen or what it currently says.
- **No visual-position names** — `leftButtonText`, `topLabel`, `secondaryText` are forbidden; if the layout changes, a position-named key becomes actively misleading.
- **No raw sentence as a key** — a key is an identifier, never the English (or Arabic) sentence itself (e.g. `bookingCancelledSuccessfully`, never `"Your booking has been cancelled successfully"` used as the key).
- **No duplicated near-equivalent keys** — `cancelButton`, `cancelBtn`, `cancelAction` must never coexist for the same concept; one key, one meaning, reused everywhere it applies.
- **No locale-specific key names** — a key is the same string across all 8 locale files; only its *value* varies. Never `cancelButtonAr`/`cancelButtonEn`.
- **Never encode Arabic or English wording into the key itself** — a key like `remainingSeatsLabel` is fine (names the concept); a key like `مقعد_متبقٍ` or `seats_remaining_text` copied from the current English string is not — keys are meaning-identifiers, not transliterated content.

## 6. Nesting Rules

- Keep nesting **shallow** — one level of grouping under the namespace is normal (`booking.slot.selectLabel`); avoid 4+ levels deep.
- **Predictable domain groupings**, not arbitrary ones — group by the same sub-concepts a reader of `src/lib/<domain>/` would already recognize (e.g. within `provider`, grouping by `services`/`bookings`/`availability` mirrors the existing query-module split), not by an ad hoc UI hierarchy that will drift from the code.
- Avoid nesting purely to mirror a component tree — a namespace's shape should survive a component being refactored or renamed.

## 7. ICU Conventions

next-intl uses ICU MessageFormat syntax natively — use it, don't reimplement it:

- **Interpolation:** `"{name} has {count} bookings"` — never string concatenation at the call site.
- **Select:** `"{gender, select, male {...} female {...} other {...}}"` for a fixed set of variants.
- **Plural:** `"{count, plural, one {# seat} other {# seats}}"` — never a manual `count === 1 ? "seat" : "seats"` conditional in component code.
- **Number/date values:** pass raw `Date`/`number` values into ICU's `{value, date}` / `{value, number}` placeholders (or use `src/lib/i18n/format-date.ts`/`format-number.ts` directly for cases outside a translated sentence) — never pre-format a value into a string before interpolating it into a message, which bakes in one locale's formatting rules regardless of which locale is actually rendering.
- **Polish, Czech, and Russian plural forms are not two-form (singular/plural) like English or Arabic's simpler pattern** — each has multiple CLDR plural categories (`one`/`few`/`many`/`other` for Polish and Russian, `one`/`few`/`other` for Czech). These **must** use ICU `plural` syntax so next-intl/ICU resolves the correct category per locale automatically — a manual `count === 1` check anywhere in application code for a pluralized string is a bug for these three locales specifically, not just a style violation.

## 8. Prohibited Patterns

- Hardcoded UI text in JSX, components, or Server Actions — every user-facing string comes from a translation key, no exceptions (`ADR-0005` requirement 5, `ADR-0010` requirement 7).
- Silent fallback to hardcoded Arabic or English text when a key is missing (`ADR-0010` requirement 9) — see §10.
- Random/ad hoc namespace creation — see §4.
- Duplicated strings across namespaces without a clear, single owning namespace.
- Presentation text (translated UI strings) living inside business/query modules under `src/lib/<domain>/` — those modules return data; the page/component layer resolves translations.
- Directly formatting money or date strings inside query modules (the exact anti-pattern the internationalization architecture analysis found in `get-services.ts`/`get-dashboard-data.ts`/etc., which currently return pre-formatted `` `${amount} ${currency}` `` strings) — formatting is a presentation concern, resolved with `src/lib/i18n/format-date.ts`/`format-number.ts` at render time, once those call sites are migrated.
- Treating a machine-generated translation as production-ready without native/professional review — machine translation may assist a first draft, never ship unreviewed (this applies to Phase E's German/Italian/Polish/French/Czech/Russian work specifically).

## 9. Canonical Key-Shape Rule

English is the canonical TypeScript message shape (`src/i18n/types.d.ts`) — every namespace/key that exists in English's message files is what the compiler checks every call site against. This is a type-safety convenience, not a statement that English is authoritative content-wise: Arabic remains the platform's primary, default language per `ADR-0005`/`ADR-0010`.

- Arabic and English must remain **complete** at every point during migration — every key added anywhere must have both an `ar` and an `en` value before that key is considered done, per `ADR-0010` requirement 8.
- **All 8 locales must have identical key structures before release** — a German, Italian, Polish, French, Czech, or Russian file may lag in translated *content* during Phase E, but its key *structure* (which keys exist) must match English's exactly by the time a feature ships; a structurally incomplete locale file is the condition §10 exists to catch, not something to ship silently.

## 10. Missing-Key Behavior

- A missing key must **fail visibly** in development and in testing — never silently substitute hardcoded Arabic or English text to paper over the gap (`ADR-0010` requirement 9).
- This is a testing/tooling requirement for Phase F (missing-key audit), not something this document invents a mechanism for — flagged here as the behavior any such mechanism must produce, not solved in this document.

## 11. Mobile/API Reuse

Per `ADR-0011`:

- UI translations (this document's entire scope) remain a **client/presentation concern** — they format what a human reads on a screen.
- APIs expose **stable, machine-readable error codes** (e.g. `SLOT_FULL`, `BOOKING_NOT_CANCELLABLE`), never a pre-localized message string as the primary contract — a client (web, future React Native app, or a partner integration) maps the code to a localized message using its own copy of the same message catalogs, rather than parsing human-readable text to determine what happened.
- A future mobile client reuses the **same locale codes** (`src/i18n/locales.ts`'s 8 values) and, ideally, the **same ICU message catalogs** (`messages/{locale}/{namespace}.json`) — this is exactly the reuse ADR-0011 requires, and is why these catalogs are plain JSON/ICU rather than a web-only templating format.

---

## Related Documents
- `LOCALIZATION.md` — the architecture this document operationalizes; owns locale negotiation, fallback priority, and regional formatting decisions this document does not restate
- `ADR-0005`, `ADR-0010` — the binding language/i18n architecture requirements this document's conventions serve
- `ADR-0011` — the API-first/mobile-ready requirements §11 restates for the message-catalog reuse case specifically
- `src/i18n/locales.ts`, `src/i18n/namespaces.ts` — the runtime single sources of truth this document's §1/§2 describe, never duplicated
- `src/lib/i18n/format-date.ts`, `format-number.ts` — the formatting utilities §7/§8 reference

## Open Questions
1. The exact tooling for the missing-key-audit / hardcoded-string-enforcement behavior §10 requires is Phase F work — not decided here.
2. Whether a lint rule should enforce §5's key-naming conventions automatically (vs. relying on code review) is not decided here — a candidate for Phase F alongside hardcoded-string enforcement.
