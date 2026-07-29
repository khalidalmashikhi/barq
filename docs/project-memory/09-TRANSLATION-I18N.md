# 09 — Translation & i18n

## Locked architectural principles (do not violate)

- **ADR-0005 — Bilingual by Design**: Arabic and English are co-equal architecture, not "Arabic + an afterthought translation layer." RTL is designed-in, not mirrored after the fact. No hardcoded UI strings. The domain/API layer stays language-neutral. Future languages must be addable as configuration, not a code rewrite. Still fully in force — only its *language count* scope was superseded by ADR-0010.
- **ADR-0010 — 8 Officially Targeted Interface Languages**: Arabic (default, RTL), English, German, Italian, Polish, French, Czech, Russian — exactly the locales in `src/i18n/locales.ts` and every `messages/{locale}/` directory. Any future i18n-architecture change requires the ADR/RFC process, not a silent code change.

## Current state

Static, developer-curated JSON files: `messages/{ar,en,de,it,pl,fr,cs,ru}/` × 10 namespaces per locale (`seo`, `notifications`, `auth`, `common`, `landing`, `pages`, `services`, `admin`, `errors`, `dashboard`, `provider`, `booking`). Real translations, not machine-generated placeholders — this discipline has held across every phase of this project. `src/middleware.ts`'s locale matcher deliberately duplicates `locales.ts`'s array (a documented, unavoidable Next.js static-analysis constraint, not an inconsistency to fix).

There is no runtime translation-management system, no admin UI for translations, and no AI-assisted translation workflow anywhere in the codebase — every string is hand-translated by a developer and committed as static JSON.

## Target: AI-assisted translation for provider-generated content

Provider-generated content (business names, descriptions, service names/descriptions — all already stored as bilingual `Json` fields like `{ar, en}` on `Provider`/`Service`) may use an AI-assisted translation workflow with **review states** — e.g., a provider writes content in one language, an AI-assisted step proposes the other language(s), and a review/approval step (admin, or the provider themselves) confirms it before it goes live.

This is distinct from and must not be confused with the **static UI translation** system above — static UI translations (button labels, page copy, error messages) remain curated by developers; only provider-generated *business content* is a candidate for the AI-assisted workflow.

## Design questions (not answered by this phase)

- Does provider content translation extend beyond the current `{ar, en}` shape to require translations in the other 6 supported locales too, or does provider content stay bilingual while UI stays 8-language?
- What review-state model fits best — a simple draft/approved flag per field, or a fuller versioned-translation history? See `13-OPEN-QUESTIONS.md`.

## Related registry entries

BR-016, BR-017 in `16-BUSINESS-RULES.md`; `Translation` entity in `15-DATA-DICTIONARY.md`.
