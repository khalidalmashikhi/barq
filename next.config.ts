import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Image domains and other config are added incrementally as the
  // corresponding capability is implemented (per
  // DEPLOYMENT_AND_INFRASTRUCTURE.md) — not invented ahead of need.
};

// Wires next-intl's request-config resolution (src/i18n/request.ts)
// into every request BARQ Internationalization Phase 0 — additive
// only: it does not itself change routing/redirect behavior (that is
// middleware.ts's job) and has no effect on routes that don't consume
// next-intl's Server Components yet.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
