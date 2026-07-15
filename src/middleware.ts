import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Locale-detection middleware — BARQ Internationalization, Phase 0.
//
// NO BUSINESS LOGIC, NO DATABASE ACCESS: next-intl's createMiddleware
// only reads/writes the NEXT_LOCALE cookie and the Accept-Language
// header — it never touches Prisma or any authenticated-user record.
// Negotiation priority for this phase (locale cookie -> Accept-Language
// -> Arabic default) is next-intl's own built-in behavior for this
// configuration; no custom priority logic is written here.
//
// Authenticated-user stored-preference sync (Customer.languagePreference)
// is DELIBERATELY NOT implemented here — middleware runs on the Edge
// runtime before any database connection is available, and reading a
// stored preference would require exactly the kind of DB access this
// phase's scope explicitly prohibits in middleware. Wiring that
// preference in (e.g. via a Server Component redirect after reading
// the session, or a dedicated cookie-sync step post-login) is real,
// necessary work for a later phase — flagged here, not solved here.
//
// MATCHER, DELIBERATELY NARROW FOR PHASE 0: only "/" (for the
// negotiated-locale redirect) and the 8 locale-prefixed path patterns
// are matched — every existing, not-yet-migrated route (/dashboard,
// /services, /bookings, /provider, /api/**) is outside this pattern
// entirely, so this middleware never runs for them and their current
// behavior is completely unaffected. This is intentionally narrower
// than next-intl's typical "everything except /api and static assets"
// example matcher, specifically because most of this application's
// routes have not moved under [locale] yet (out of scope for this
// phase) — widening this matcher is real, expected work for the phase
// that actually migrates those routes, not an oversight here.
export default createMiddleware(routing);

// config.matcher IS STATICALLY ANALYZED BY NEXT.JS AT BUILD TIME —
// READ BEFORE TOUCHING THE LINE BELOW.
//
// Next.js extracts `config.matcher` via an AST walk of this module
// BEFORE the module is ever executed (see
// next/dist/build/analysis/extract-const-value.js) — it does not run
// this file's code to compute the value. An imported array or any
// computed expression (e.g. `locales.join("|")`, or spreading
// `locales` from src/i18n/locales.ts into a template literal) is NOT
// reliably extracted this way: this was tried directly, verified
// against a running dev server, and found to silently fail — Next.js
// fell back to matching every single path (`/:path*`) instead of the
// intended narrow set, which would have redirected /dashboard,
// /services, /provider, and even /api/** to a locale-prefixed 404. It
// produced no build error and no warning; the only way this was
// caught was live `curl` testing against the actual running
// middleware, not by reading the source or the type-checker.
//
// THE LITERAL BELOW THEREFORE INTENTIONALLY DUPLICATES THE LOCALE
// LIST from src/i18n/locales.ts — this is the ONE deliberate exception
// to this codebase's "do not duplicate locale arrays" rule, made for
// the framework reason stated above, not by choice or oversight.
//
// Contributors: when adding or removing a locale, you MUST update
// BOTH of the following by hand, in the same change:
//   1. src/i18n/locales.ts (the `locales` array — the single runtime
//      source of truth for every other consumer in this codebase)
//   2. the literal matcher array immediately below
// Do NOT "clean this up" into `locales.join("|")` or any other
// runtime computation — that exact refactor is what silently breaks
// the matcher, per the verified failure above. If a future Next.js
// version changes this static-analysis limitation, that fact should
// be re-verified live (not assumed from a changelog) before removing
// this duplication.
export const config = {
  matcher: ["/", "/(ar|en|de|it|pl|fr|cs|ru)", "/(ar|en|de|it|pl|fr|cs|ru)/:path*"],
};
