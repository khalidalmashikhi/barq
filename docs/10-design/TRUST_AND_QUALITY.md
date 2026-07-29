# Trust, Safety & Marketplace Quality (Phase F.4)

## 1. Trust Philosophy

BARQ's product goal for this phase: a user should trust BARQ on sight — governmental in reliability, premium in polish, honest in every claim. Every trust signal shipped this phase maps to a real, already-implemented feature:

| Signal shown to users | Backed by |
|---|---|
| "Verified Provider" badge | `Provider.status === APPROVED` (real approval gate, built Phase F.2) |
| "Secure booking" / "Booking protection" | The real booking-lifecycle audit trail (`BookingStatusEvent`, Phase E.1) |
| "Flexible cancellation" notice | The real `canCancelBooking()` rule (CREATED/CONFIRMED only) |
| Cancellation & Refund card on booking detail | Same real rule + honest note that no automated refund pipeline exists |
| Safety Information section | General responsibility/guidance copy — no per-service safety data exists, so no per-service claim is made |
| Organization JSON-LD | Real `name`/`url`/`logo` only — no fabricated rating/review/founder fields |

**What we deliberately did not build:** a government/regulatory partnership claim on the About page (checked `docs/01-business/BUSINESS_MODEL.md` — Ministry of Heritage & Tourism licensing is listed as an *unresolved risk*, not a credential); a support email or working hours on the Contact page (no real inbox is wired up anywhere in this codebase); real legal text on Terms/Privacy/Cookies/Booking Policy (professional layout shells only, each carrying an explicit "not yet legally reviewed" notice).

## 2. Marketplace Principles

Trust · Simplicity · Clarity · Confidence · Speed — the five words used consistently across the About page's Marketplace Principles section and this phase's own internal design language. They describe how the booking lifecycle, pricing display, and status tracking already behave; this phase's job was to *state* that behavior honestly, not to invent new behavior.

## 3. New Public Pages (this phase)

- Help Center hub + FAQ + Booking Help + Provider Help (`/help`, `/help/faq`, `/help/booking`, `/help/provider`)
- Contact & Support (`/contact`) — informational only, states plainly that direct contact isn't wired up yet
- About BARQ (`/about`)
- Terms of Service, Privacy Policy, Cookie Policy, Booking & Cancellation Policy (`/terms`, `/privacy`, `/cookies`, `/booking-policy`)

All eight routes: `StaticPageLayout` (shared Navbar/heading/Footer shell), full `buildLocalizedMetadata()` coverage (canonical + 8-locale hreflang + x-default + OG + Twitter Card), and real translated content in all 8 locales (ar/cs/de/en/fr/it/pl/ru) — no placeholder strings.

## 4. Accessibility Checklist

- [x] Skip link (`SkipLink` component) — jumps to `#main-content`, present on every page via the root layout
- [x] `id="main-content"` present on every touched public page's `<main>`
- [x] Heading hierarchy: every new page has exactly one `<h1>` (page title) and `<h2>`s per section, no skipped levels
- [x] FAQ disclosures use native `<details>/<summary>` — keyboard-operable and screen-reader-announced with zero custom ARIA
- [x] Reduced motion: `prefers-reduced-motion` blanket override already in `globals.css` (Phase F.1) covers all new animated elements
- [x] Focus-visible rings on all new interactive cards/links (Help Center cards, Contact page's Help Center link)
- [x] Offline banner uses `role="status"` for assistive-tech announcement

## 5. SEO Checklist

- [x] `generateMetadata()` on every new public page: title, description, canonical, 8-locale hreflang + x-default
- [x] Open Graph: `type`, `siteName`, `locale`, `images` (real `/logo.png`, not fabricated) — added to `buildLocalizedMetadata()` for every page that uses it, old and new
- [x] Twitter Card: `summary` variant (not `summary_large_image` — no wide-format image exists)
- [x] Organization JSON-LD at the root layout: `name`/`url`/`logo` only, no fabricated `aggregateRating`/`review`/`founder`
- [x] `robots.ts` already allows `/` by default and only disallows private routes (`/dashboard`, `/bookings`, `/notifications`, `/provider`) — every new public route is crawlable with no change needed
- [ ] Sitemap — still deliberately absent (documented limitation from Phase D.3, unchanged this phase: a real sitemap needs a live/published-service enumeration job, out of scope for a presentation-layer phase)

## 6. Design Consistency Checklist

- [x] Card pattern: `rounded-2xl border border-border bg-card p-5/p-6` used identically across Help Center cards, About sections, Safety Info cards, Trust Panel, Legal sections
- [x] Icon treatment: `bg-accent/15 text-primary` icon chips, consistent with Provider/Customer dashboard KPI cards from F.2/F.3
- [x] `Alert` component (built Phase F.1) reused for the legal-pages "not yet finalized" notice — no new alert style invented
- [x] Footer restructured into a real 3-column layout (brand/Explore/Company) using the `browseHeading`/`companyHeading` keys that existed since Phase F.1 but were never rendered until this phase
- [x] `FaqAccordion` extracted from the landing page's hardcoded version and reused for the new Help Center FAQ — one component, two content sets, zero duplicated markup

## 7. Production Quality Checklist

- [x] `npx tsc --noEmit` — 0 errors
- [x] `npx eslint src/` — 0 errors/warnings
- [x] `npx vitest run` — 44 files / 315 tests passing
- [x] `npm run build` — succeeds from a fully cleared `.next/` (verified twice)
- [x] Zero backend/business-logic files touched (verified via mtime comparison against the first Phase F.4 file — see the phase completion report)
- [x] Zero new untranslated placeholder keys introduced this phase (all 8 locales checked via grep)
- [ ] **Known, pre-existing gap (not introduced this phase, not fixed this phase):** 1,092 untranslated placeholder strings remain in cs/de/fr/it/pl/ru across `auth`/`booking`/`common`/`dashboard`/`errors`/`notifications`/`provider`/`seo`/`services` — predates Phase F.4, documented as a deferred follow-up in the phase completion report.
