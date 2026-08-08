import { IBM_Plex_Sans_Arabic, IBM_Plex_Sans } from "next/font/google";

// Shared font definitions (BARQ i18n). Extracted from the root layout so the
// locale layout (src/app/[locale]/layout.tsx) — which now owns <html>/<body>
// — and the root not-found (src/app/not-found.tsx), which renders its own
// <html>/<body>, both apply the same self-hosted typefaces without
// duplicating the next/font declarations. next/font must be called at module
// scope; a shared module is the canonical way to reuse the same instance.
//
// IBM Plex Sans Arabic (Arabic) + IBM Plex Sans (Latin) — a matched pairing
// from one type family; both self-hosted at build time by next/font/google
// (no runtime CDN request, no layout shift).

export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const plexLatin = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-latin",
  display: "swap",
});
