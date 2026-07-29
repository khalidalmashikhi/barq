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

export const navLinks = [
  { labelKey: "nav.browse", href: "/services" },
  { labelKey: "nav.howItWorks", href: "#how-it-works" },
  { labelKey: "nav.destinations", href: "#destinations" },
] as const;
