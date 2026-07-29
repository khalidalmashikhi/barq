# BARQ Design System — Implementation

- **Purpose:** The concrete, implementation-level companion to `docs/04-experience/DESIGN_SYSTEM.md` (locked v1.0, principles-only, ADR-gated). That document deliberately deferred every concrete value — specific colors, typefaces, breakpoints, component APIs — as "Open Decisions" (§22), pending a real visual identity brief and real implementation. This document records what has actually been built: real hex values, real component inventory, real Tailwind tokens — resolving those Open Decisions in code, not just in principle.
- **Scope:** Color palette, typography, radius/shadow/spacing tokens, component inventory, responsive behavior, motion, accessibility, and what Phase F.1 covered vs. deferred.
- **Out of Scope:** Restating `docs/04-experience/DESIGN_SYSTEM.md`'s principles (referenced, not repeated) — see that document for *why* these choices matter; this one documents *what* they are.
- **Owner:** Whoever continues the UI/UX redesign in Phase F.2+ — keep current as the design system grows.
- **Status:** Added Phase F.1 (Complete UI/UX Redesign Foundation).

---

## 1. Design Philosophy (Inherited, Not Restated)

Every principle in `docs/04-experience/DESIGN_SYSTEM.md` §2 (Trust First, Clarity over Decoration, Speed First, Mobile First, Accessibility by Design, Bilingual by Design, Consistency, Minimal Cognitive Load) governs this implementation. This phase's own added mandate — "Would this screen feel at home beside Airbnb or GetYourGuide?" — is the practical test applied to every section built: large destination imagery (where real photography exists), generous whitespace, one coherent visual language, emotion (the Hero, Popular Destinations) before administration (a form).

## 2. What Already Existed vs. What Phase F.1 Added

**Important context for whoever reads this next:** BARQ's UI was *not* a blank slate. A prior, uncommitted-until-now pass ("Visual Identity Redesign," `git log` commit `e3f0e0f`) had already built: the color palette below, the IBM Plex Sans Arabic/Latin typography, the `Button`/`Card`/`Logo`/`EmptyState` primitives, premium gradient/glass/shadow utilities, entrance animation, and a full `Navbar`/`Footer`/`MobileNav` set — **but that navigation set was never rendered by any page** (its own code comment said so explicitly), used fabricated routes (`/experiences`, `/tours`, `/about`, none of which exist), and hardcoded Arabic-only strings inconsistent with this project's next-intl architecture. And the site's `/` route doubled as the login form itself — every unauthenticated visitor was dropped straight into an OTP form, with no way to browse or feel "inspired to explore destinations" (this phase's own Product Vision).

Phase F.1's actual work was therefore: **complete and correctly wire what existed, build the genuinely missing pieces, and fix the site's single biggest structural gap** (no real landing page) — not redesign what was already good.

## 3. Color Palette

Defined in `tailwind.config.ts` / `src/app/globals.css` as CSS custom properties (light values; a dark-mode block exists structurally, matching `docs/04-experience/DESIGN_SYSTEM.md` §20's "not a V1 commitment"):

| Role | Value | Usage |
|---|---|---|
| Primary | `#4F2D8C` (purple) | Primary CTAs, brand presence |
| Secondary | `#2C7A7B` (teal) | Secondary actions, accents |
| Accent | `#F5B942` (gold) | Sparse highlight (ratings, category chips) |
| Background | `#F7F8FA` | Page background |
| Card | `#FFFFFF` | Surface layering |
| Foreground | `#0F172A` | Primary text |
| Border | `rgba(15,23,42,0.08)` | Structural dividers |
| Success | `#16A34A` | Positive status |
| Danger | `#DC2626` | Error/destructive status |

Every role above resolves `docs/04-experience/DESIGN_SYSTEM.md` §4's structural roles (Primary/Secondary/Accent/Success-Warning-Error/Neutral/Surface/Text) into concrete values — the "pending the actual BARQ logo asset" caveat in that document (§22 #1) is still technically open (no logo asset exists in this sandbox — `Logo` component falls back gracefully between `/logo.svg` and `/logo.png`), but a real, coherent palette is in production use regardless.

## 4. Typography

`IBM Plex Sans Arabic` + `IBM Plex Sans` (Latin), loaded via `next/font`, referenced as `var(--font-plex-arabic)`/`var(--font-plex-latin)` in `tailwind.config.ts`'s `fontFamily.sans`. Chosen (per that file's own comment) because both are designed by the same foundry with a genuinely matched Latin companion — Arabic and English carry the same visual rhythm at the same weight, resolving `docs/04-experience/DESIGN_SYSTEM.md` §5's deferred typeface decision (§22 #2) and its "switching languages doesn't feel like switching products" requirement.

Scale in active use: `text-sm` (14px) body/labels, `text-base`/`text-lg` card titles, `text-2xl`–`text-3xl` section subheads, `text-4xl`–`text-6xl` hero headlines (responsive: `text-4xl sm:text-5xl lg:text-6xl` on the landing Hero).

## 5. Radius, Shadow, Spacing

- **Radius:** `xl` = 0.875rem, `2xl` = 1.25rem (`tailwind.config.ts`) — cards, buttons, inputs, and the new primitives (Badge uses `rounded-full`, Alert/Skeleton use `rounded-xl`) all draw from this same limited set, per §6's "one visual language for roundedness."
- **Shadow:** `shadow-premium` / `shadow-premium-lg` (globals.css) — layered, soft shadows distinguishing Cards from elevated surfaces (the login page's glass card, the landing CTA band).
- **Spacing:** Tailwind's default 4px-based scale, used in multiples of 2 (8px) throughout — no arbitrary one-off spacing values introduced this phase.
- **Motion:** `animate-fade-up` (one deliberate entrance animation, used once per view, not scattered) and `animate-pulse` (the new `Skeleton` primitive) — both respect `prefers-reduced-motion` via `globals.css`'s existing blanket override, satisfying §14's binding accessibility requirement with zero new motion-handling code needed.

## 6. Component Inventory

| Component | Status this phase | File |
|---|---|---|
| Button | Pre-existing, unchanged | `src/components/ui/button.tsx` |
| Card | Pre-existing, unchanged | `src/components/ui/card.tsx` |
| EmptyState | Pre-existing, unchanged | `src/components/ui/empty-state.tsx` |
| Logo | Pre-existing, unchanged | `src/components/ui/logo.tsx` |
| Pagination | Pre-existing, unchanged | `src/components/ui/pagination.tsx` |
| **Badge** | **New** | `src/components/ui/badge.tsx` |
| **Alert** | **New** | `src/components/ui/alert.tsx` |
| **Skeleton** | **New** | `src/components/ui/skeleton.tsx` |
| **Chip** | **New** | `src/components/ui/chip.tsx` |
| **Tabs** (Tabs/TabsList/TabsTrigger/TabsContent) | **New** | `src/components/ui/tabs.tsx` |
| Navbar / Footer / MobileNav | **Fixed and wired in** (existed, unrendered, broken i18n/routing) | `src/components/layout/` |

**Deliberately not built this phase:** Modal/Dialog, Toast, Dropdown, a data Table component. None were required by the two pages this phase actually delivers (Login, Landing) — see §8's Future Work. Building them without a real consumer risked exactly the kind of speculative, untested component this project's own "Composition over Duplication" principle warns against.

All new primitives are plain, dependency-free (matching `clsx.ts`'s own "no new npm dependency for a small need" precedent), fully keyboard/ARIA-accessible (Tabs: `role="tablist"/"tab"/"tabpanel"`, roving `tabIndex`, `aria-selected`/`aria-controls`; Alert: `role="alert"`/`"status"`), and reference only the token roles in §3–§5 — no new colors invented.

## 7. Pages Delivered

- **`/login`** (`src/app/[locale]/login/page.tsx`) — relocated from `/`, substance unchanged (OTP state machine, Better Auth calls — all untouched, Auth/OTP is off-limits this phase), hero copy newly internationalized (was hardcoded Arabic-only, explicitly flagged as "out of scope" in the prior version).
- **`/` (Landing Page)** (`src/app/[locale]/page.tsx`) — new. Sections, in order: Hero+Search, Featured Experiences (real data via `getServices()`), Categories (inspirational, not a functional filter — see §9), Popular Destinations (same caveat), Trusted Providers (real approved providers via `getProvidersForFilter()`), How BARQ Works, Why Choose BARQ, Statistics ("BARQ in Numbers" — real counts via the new `getPlatformStats()`, never fabricated), Testimonials (explicitly placeholder, visibly disclosed as such), FAQ (native `<details>`/`<summary>`, zero JS), final CTA, Footer.

## 8. Responsive & Accessibility Verification (This Phase)

Live-verified in the actual dev server (not just code review): full page render at desktop width (all 11 sections, real data, correct order); Arabic locale (`/ar`) full RTL translation with zero missing keys; mobile viewport (375×812) — zero horizontal overflow (`document.documentElement.scrollWidth === clientWidth`, confirmed via direct DOM query); mobile hamburger menu opens and shows correctly translated links. A genuine bug was found and fixed during this verification: a Server Component (`DestinationsSection`) importing a plain data constant (`DESTINATION_IMAGES`) from a `"use client"` file received `undefined` for every value (Next.js treats a "use client" module's exports as client references even for non-component constants) — fixed by extracting the data to its own plain, non-"use client" module (`destination-images.ts`).

Screenshot capture was not available in this session (a tooling limitation, not an application issue) — verification instead used direct DOM/text inspection (`get_page_text`, `read_console_messages`, `javascript_tool` queries against `document.querySelectorAll`), which is what actually caught the bug above.

## 9. Honesty Notes (Read Before Building On This)

- **Categories and Popular Destinations are inspirational, not functional filters.** `Service.serviceType` is a technical CTI discriminator, not a business taxonomy category, and no location field exists on `Service`/`Provider` yet (`get-services.ts`'s own long-standing documented schema gaps, predating this phase). Every category/destination card links to `/services` generally. Wiring these to real filters requires a schema decision this phase's "No database changes" rule explicitly forbids making.
- **No real Oman photography exists in this sandbox.** `DestinationImage` shows an honest, quiet fallback (a muted icon) rather than a fake gradient dressed up as a photo, wherever a listed image path doesn't resolve to a real file.
- **Statistics are real, not invented.** "BARQ in Numbers" shows actual published-service and approved-provider counts — no "10,000+ happy travelers" style fabricated figure.
- **Testimonials are explicitly placeholder**, visibly disclosed in the UI itself, per this phase's own requirement.

## 10. Remaining UI Work (Phase F.2+)

- Dashboard redesign (goal 7) — largely untouched this phase beyond what already existed.
- Forms redesign across booking/provider flows (goal 8).
- Full error-experience pass: 404/500/offline/permission states beyond what Phase D.3 already built (goal 10).
- A full accessibility audit beyond this phase's spot-checks (goal 11).
- Performance/Lighthouse pass (goal 12) — not run this phase; see the Verification section of the report.
- Modal, Toast, Dropdown, Table primitives — build when a real page needs one.
- Real Oman photography, once available.
