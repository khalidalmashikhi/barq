// Shared nav link data — Phase F.1 (UI/UX Redesign Foundation).
//
// REPLACES the prior version's fabricated routes (/experiences,
// /tours, /transportation, /drivers, /about, /contact — none of which
// exist anywhere in this app) and hardcoded Arabic strings (not
// i18n-aware, inconsistent with every other component in this
// codebase). Every href below is a real, working destination: /services
// (the actual experience-browsing route) or an in-page anchor on the
// new public landing page these links are now actually wired into
// (src/app/[locale]/page.tsx) — Navbar/Footer/MobileNav were built in
// an earlier, unfinished pass and never rendered by any page until
// this phase.
//
// `labelKey` references the "landing" translation namespace's `nav.*`
// keys — each consumer (Navbar: Server Component via
// getServerTranslator; MobileNav: Client Component via
// useTranslations) resolves its own label, since a plain data array
// can't carry a resolved translation across that boundary itself.

// AUTH-NAV-3 — dead-anchor cleanup: the "#how-it-works" and "#destinations"
// in-page anchors targeted sections that only existed on the OLD dense homepage;
// HOME-1 (approved) no longer renders them, so those anchors scrolled nowhere in
// every surface that renders this list (Navbar, Footer, MobileNav). Removed
// rather than repointed — there is no existing page whose semantics genuinely
// match either anchor, and the rule is not to re-add Home sections just to keep
// an anchor alive. "Browse" (→ /services) is the one real, working destination.
// The now-unused nav.howItWorks / nav.destinations message keys are left in
// landing.json untouched (harmless, and removing them across 8 locales is
// unrelated churn).
export const navLinks = [{ labelKey: "nav.browse", href: "/services" }] as const;
