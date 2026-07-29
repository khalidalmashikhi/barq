import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Omits the "X-Powered-By: Next.js" response header — avoids
  // advertising the framework/version to every client for no benefit.
  poweredByHeader: false,
  // Image domains and other config are added incrementally as the
  // corresponding capability is implemented (per
  // DEPLOYMENT_AND_INFRASTRUCTURE.md) — not invented ahead of need.

  // Phase C.1 (Infrastructure & Quality) — baseline security headers,
  // extended by Phase D.3 (Production Hardening) below.
  async headers() {
    // Phase D.3 — Content-Security-Policy, deliberately deferred at
    // Phase C.1 pending a real audit of this app's actual script/
    // style/font sources. That audit is done: next/font self-hosts
    // both typefaces (no runtime request to Google's CDN), Better
    // Auth's client calls only this app's own origin, and a repo-wide
    // search confirms zero uses of dangerouslySetInnerHTML or any
    // third-party <script> tag anywhere in src/.
    //
    // 'unsafe-inline' on script-src/style-src IS still required —
    // Next.js's own hydration bootstrap injects inline <script> data,
    // and this app has no nonce-per-request infrastructure (that would
    // need middleware changes to generate and thread a nonce through
    // every response, a materially bigger change than this phase's
    // "safe, non-breaking" mandate). This is a real, intentional
    // trade-off, not an oversight: it still blocks the two things a
    // CSP most commonly exists to stop — script/style/frame injection
    // from a THIRD-PARTY origin — while not requiring a nonce system
    // this phase doesn't build. A stricter, nonce-based CSP remains a
    // legitimate future improvement once that infrastructure exists —
    // documented here as deferred, not silently dropped.
    //
    // PRODUCTION ONLY: Next.js dev mode's own Fast Refresh/HMR requires
    // additional script-eval capability this CSP deliberately doesn't
    // grant — gating to NODE_ENV=production keeps local `next dev`
    // completely unaffected, matching this task's "only implement
    // headers that are safe without breaking the application" mandate.
    // Live-verified against a real `next build && next start` run
    // across the public marketplace (including framer-motion
    // animations), login, Customer Dashboard, and Provider Dashboard —
    // zero CSP violations in the browser console.
    const cspHeader =
      process.env.NODE_ENV === "production"
        ? [
            {
              key: "Content-Security-Policy",
              value: [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "font-src 'self' data:",
                "connect-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
              ].join("; "),
            },
          ]
        : [];

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Kept alongside CSP's frame-ancestors (below) as
          // defense-in-depth for browsers that don't yet honor
          // frame-ancestors — the two do not conflict.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          // Phase D.3 — HSTS. Safe unconditionally: browsers ignore
          // Strict-Transport-Security entirely over a plain-HTTP
          // connection (which local `next dev`/`next start` always
          // is), so this has zero effect in development and only ever
          // activates once the app is actually served over HTTPS.
          // `preload` additionally requires submission to the browser
          // vendors' HSTS preload list — not done as part of this
          // phase (that is a one-time, manual, external submission
          // step, not a code change) — documented here as a follow-up,
          // not silently assumed complete.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          ...cspHeader,
        ],
      },
    ];
  },

  // Phase B Group 1 — Dashboard legacy-URL compatibility.
  //
  // /dashboard moved to /[locale]/dashboard. Rather than a custom
  // compatibility stub page, this uses Next.js's own native redirects()
  // config: the first rule fires only when a `NEXT_LOCALE` cookie is
  // present and holds one of the 8 approved locale codes (captured via
  // the named group `locale`), redirecting straight to that locale's
  // dashboard. The second rule is the fallback for a missing or
  // unrecognized cookie value, matching this app's own default-locale
  // fallback used everywhere else. Rules are evaluated in order — the
  // first matching rule wins — so the cookie-aware redirect is always
  // tried before the default-locale fallback.
  //
  // Runs at the Next.js routing layer, before any page component would
  // otherwise resolve — no middleware change (middleware.ts's matcher
  // stays exactly as-is until Phase B Group 6), no new page file, no
  // custom locale-resolution helper to write or maintain. `permanent:
  // false` (a 307) deliberately avoids a permanently-cached redirect,
  // since this entire mechanism is temporary: Phase B Group 6 removes
  // it once middleware.ts's own matcher is widened to cover this path
  // natively.
  async redirects() {
    return [
      {
        source: "/dashboard",
        has: [
          {
            type: "cookie",
            key: "NEXT_LOCALE",
            value: "(?<locale>ar|en|de|it|pl|fr|cs|ru)",
          },
        ],
        destination: "/:locale/dashboard",
        permanent: false,
      },
      {
        source: "/dashboard",
        destination: "/ar/dashboard",
        permanent: false,
      },

      // Phase B Group 2 — Services legacy-URL compatibility.
      //
      // Same pattern as Group 1's /dashboard rules above, generalized to
      // the whole Services subtree. `/services/:path*` matches the bare
      // `/services` path (zero segments) as well as any dynamic
      // sub-path (`/services/123`, `/services/123/book`, etc.) because
      // Next.js's path-to-regexp folds the separating slash into the
      // repeated group when it's empty.
      {
        source: "/services/:path*",
        has: [
          {
            type: "cookie",
            key: "NEXT_LOCALE",
            value: "(?<locale>ar|en|de|it|pl|fr|cs|ru)",
          },
        ],
        destination: "/:locale/services/:path*",
        permanent: false,
      },
      {
        source: "/services/:path*",
        destination: "/ar/services/:path*",
        permanent: false,
      },

      // Phase B Group 3 — Bookings legacy-URL compatibility. Same
      // pattern as Groups 1 and 2, generalized to the Bookings subtree
      // (covers the bare list, `/bookings/:id`, and
      // `/bookings/:id/confirmation`).
      {
        source: "/bookings/:path*",
        has: [
          {
            type: "cookie",
            key: "NEXT_LOCALE",
            value: "(?<locale>ar|en|de|it|pl|fr|cs|ru)",
          },
        ],
        destination: "/:locale/bookings/:path*",
        permanent: false,
      },
      {
        source: "/bookings/:path*",
        destination: "/ar/bookings/:path*",
        permanent: false,
      },

      // Phase B Group 4 — Provider legacy-URL compatibility. Same
      // pattern as Groups 1-3, generalized to the whole Provider
      // subtree (overview, services list/detail, bookings,
      // availability).
      {
        source: "/provider/:path*",
        has: [
          {
            type: "cookie",
            key: "NEXT_LOCALE",
            value: "(?<locale>ar|en|de|it|pl|fr|cs|ru)",
          },
        ],
        destination: "/:locale/provider/:path*",
        permanent: false,
      },
      {
        source: "/provider/:path*",
        destination: "/ar/provider/:path*",
        permanent: false,
      },
    ];
  },
};

// Wires next-intl's request-config resolution (src/i18n/request.ts)
// into every request BARQ Internationalization Phase 0 — additive
// only: it does not itself change routing/redirect behavior (that is
// middleware.ts's job) and has no effect on routes that don't consume
// next-intl's Server Components yet.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
