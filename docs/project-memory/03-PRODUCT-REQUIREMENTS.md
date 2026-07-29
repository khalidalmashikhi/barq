# 03 — Product Requirements (living direction document)

This is the closest thing to a living PRD until `docs/01-product/PRODUCT_REQUIREMENTS.md` (the formal, Locked architecture-phase document) is revised through the ADR/RFC process. It captures the product direction as stated during this project's project-memory phase, verbatim in substance. Cross-reference `01-CURRENT-STATE.md` for what of this already exists versus what is entirely target state.

## Product identity

- BARQ is a multi-language tourism marketplace for Oman.
- The official Arabic name is **"برق"**, never "بارق" (see `13-OPEN-QUESTIONS.md` for a known existing inconsistency in `messages/ar/landing.json`).

## Data-driven business configuration

Categories, subcategories, visibility, pricing models, commissions, provider requirements, forms, homepage sections, and business content must be data-driven and manageable from the admin panel — not hardcoded, not requiring a code deploy to change.

## Categories

Categories may be in one of these states:
- `PUBLIC`
- `HIDDEN`
- `LINK_ONLY`
- `INVITE_ONLY`
- `SCHEDULED`
- `ARCHIVED`

An admin can hide or activate accommodation, transport, restaurants, activities, or any category without code changes.

## Provider onboarding

- Providers register according to provider type and category.
- Individuals and commercial entities have different onboarding requirements.
- Commercial providers may submit: commercial registration, municipal licence, tenancy agreement, bank account information, logo, images, website, Google Maps location, opening hours, and contact details.
- Category-specific requirements must be configurable.
- Every provider and service must have a professional public page.

## Communication policy

- Provider direct phone number, WhatsApp, and email must not be exposed to tourists.
- Customer communication must pass through BARQ.
- BARQ-owned contact numbers and the "ساعدني" support channel are used for customer assistance.
- Messaging, support tickets, booking inquiries, and quote requests must stay inside the platform.

## Commissions and pricing

- Admin controls commission rules per category, subcategory, service, or individual provider.
- Commission models may include: percentage, fixed amount, percentage plus fixed amount, zero commission, or manually agreed commission.
- Financial calculations must distinguish: gross booking amount, discounts, taxes, BARQ commission, provider net amount, paid amount, outstanding amount, settlement status, and transfer status.
- Pricing may be controlled by: admin, provider, both with approval, or request-for-quote.

## Languages

Supported interfaces and content languages: Arabic, English, German, Italian, Polish, French, Czech, and Russian.
- Static UI translations must remain curated (developer-maintained, not auto-generated).
- Provider-generated content may use an AI-assisted translation workflow with review states.

## Architecture constraints

- Architecture must remain API-first.
- Preserve ADR-0010 (i18n) and ADR-0011 (API-first architecture).
- Core security, authentication, payment integrity, and permission enforcement must remain code-controlled.
- Business configuration should be admin-controlled where safe.

## Planned platform engines

1. Business Engine
2. Dynamic Category Management
3. Form Builder
4. Workflow Engine
5. Rule Engine
6. Notification Engine
7. Financial and Commission Engine
8. Translation Management
9. CMS and Dynamic Homepage
10. Feature Flags
11. Provider Onboarding and Approval
12. Support / "ساعدني" Ticket Center
13. Internal Messaging Center
14. AI Center
15. Audit Trail and Permission Engine

See `../plans/ROADMAP.md` for proposed sequencing, `01-CURRENT-STATE.md` for what already exists toward each of these, and `21-ENGINE-SPECIFICATIONS.md` for each engine's full Purpose/Responsibilities/Dependencies/Inputs/Outputs specification.
