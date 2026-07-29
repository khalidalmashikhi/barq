import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Locale-detection middleware — BARQ Internationalization.
//
// NO BUSINESS LOGIC, NO DATABASE ACCESS: next-intl's createMiddleware
// only reads/writes the NEXT_LOCALE cookie and the Accept-Language
// header — it never touches Prisma or any authenticated-user record.
// Negotiation priority (locale cookie -> Accept-Language -> Arabic
// default) is next-intl's own built-in behavior for this
// configuration; no custom priority logic is written here.
//
// Authenticated-user stored-preference sync (Customer.languagePreference)
// is DELIBERATELY NOT implemented here — middleware runs on the Edge
// runtime before any database connection is available, and reading a
// stored preference would require exactly the kind of DB access this
// file's scope prohibits. Wiring that preference in (e.g. via a Server
// Component redirect after reading the session, or a dedicated
// cookie-sync step post-login) remains real, unstarted work — flagged
// here, not solved here.
//
// MATCHER, FINAL (Phase B Group 6): every real page in this app now
// lives either under /[locale]/** (Dashboard, Services, Bookings,
// Provider all migrated in Groups 1-4) or under /api/**. The matcher
// below — "/" plus the 8 locale-prefixed patterns — is therefore
// already complete: it matches every real page and nothing else. The
// bare, unprefixed legacy paths (/dashboard, /services, /bookings,
// /provider) are NOT matched here on purpose; they no longer exist as
// real pages at all, only as `redirects()` sources in next.config.ts
// (Groups 1-4's compatibility layer), which runs earlier in Next.js's
// request pipeline and always redirects to a locale-prefixed URL
// before this middleware would ever see the request. This is also why
// invalid-locale handling (e.g. /xx/services) is NOT this middleware's
// job: the matcher's strict locale alternation means a path with an
// unrecognized locale segment never matches it at all and falls
// through to normal App Router resolution, where
// src/app/[locale]/layout.tsx's own hasLocale() check calls notFound()
// — verified live, not assumed (see Group 6's verification report).
//
// This is also an allowlist, not a denylist: unlike next-intl's usual
// "match everything except /api, _next, and files with an extension"
// example matcher, this one can only ever match "/" or a locale
// prefix. /api/**, /_next/**, /favicon.ico, and every file under
// public/ (images, fonts, logo.*) are excluded by construction, not by
// an exclusion pattern that could miss a future asset type. No
// robots.txt/sitemap.xml/manifest.webmanifest exists in this project
// (verified during Group 5's SEO survey); if one is added later under
// src/app/, it still needs no matcher change, for the same reason.
//
// `alternateLinks: false` is set on `routing` itself
// (src/i18n/routing.ts), not passed here — next-intl's own types place
// that option on the routing config, not as a second argument to
// createMiddleware(). See routing.ts for the rationale (Phase B
// Group 5 Closure).
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
