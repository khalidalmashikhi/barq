import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/seo/build-public-url";

// robots.txt — Phase D.3 (Production Hardening).
//
// COARSE, SECONDARY MECHANISM ONLY: the authoritative "don't index
// this" signal for every authenticated route is already the per-page
// `robots: { index: false, follow: false }` metadata each of them sets
// individually (Phase B Group 5 Closure onward) — this file is a
// second, coarser layer for crawlers that respect robots.txt disallow
// rules, not a replacement for that per-page mechanism. The wildcard
// segment (`/*/dashboard` etc.) matches any of the 8 locale prefixes
// this app always uses (localePrefix: "always") — Google/Bing both
// support `*` as a wildcard in robots.txt disallow patterns (a de facto
// extension beyond the original spec, but the one that matters for the
// crawlers a real deployment cares about).
//
// SITEMAP REFERENCE — Growth Foundations phase: src/app/sitemap.ts now
// exists (a real, on-demand dynamic route enumerating PUBLISHED
// Services and APPROVED+visible Providers from the database), closing
// the gap this file previously documented as a deliberate absence. See
// src/app/sitemap.ts's own header comment for what it enumerates and why.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/*/dashboard", "/*/bookings", "/*/notifications", "/*/provider"],
    },
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}
