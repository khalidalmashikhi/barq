import type { MetadataRoute } from "next";

// Web app manifest — Phase D.3 (Production Hardening).
//
// Brand Identity Reset (2026-07) — Phase 1: Brand Foundation. This is
// exactly the "future phase" the previous version of this comment
// anticipated: dedicated square PWA icons now exist
// (public/brand-icon-192.png, public/brand-icon-512.png), generated
// via a mechanical crop + resize of the new official logo
// (public/Barqlogo.png) — the icon-only mark region was cropped out
// (no wordmark/tagline, illegible at small sizes) and padded onto a
// transparent square canvas; no artwork was redrawn or invented, only
// existing approved pixels cropped and resized. Real dimensions
// declared below, not fabricated. The old non-square logo.svg/logo.png
// entries are removed since they're the prior (purple) mark.
//
// name/short_name/description reused from the same source of truth
// every other piece of metadata already uses (next-intl's "common" and
// "seo" namespaces) would require this file to become an async
// Server Component variant with a specific locale — but manifest.ts is
// requested once, unscoped to any particular locale segment, by the
// browser directly (not through a page render), so there is no
// request-scoped locale to resolve here. A single, neutral English
// name/description is used instead, consistent with how
// generateMetadata's own metadataBase (src/app/layout.tsx) is
// similarly locale-agnostic infrastructure, not page content.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BARQ — Smart Tourism Operations Platform",
    short_name: "BARQ",
    description: "Book trustworthy tourism experiences in Oman.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    // The project's real brand primary color (tailwind.config.ts's
    // `primary.DEFAULT`), not a generic placeholder.
    theme_color: "#094367",
    icons: [
      {
        src: "/brand-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
