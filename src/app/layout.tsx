import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// This root layout sets Arabic as the default language and RTL as the
// default direction, per ADR-0005 (Bilingual by Design) and
// PROJECT_MANIFEST.md Core Value 4 (Arabic-first). Full locale negotiation
// (stored user preference → request-level negotiation → Arabic default),
// per LOCALIZATION.md §3, is a follow-up implementation task — this initial
// scaffold intentionally does not invent that mechanism ahead of its own
// specification being implemented.
//
// Typography: IBM Plex Sans Arabic (Arabic) + IBM Plex Sans (Latin) — a
// genuinely matched pairing from the same type family, per the visual
// identity brief's "Tajawal or IBM Plex Sans Arabic" choice, resolved in
// tailwind.config.ts's comment. Both loaded via next/font/google, which
// self-hosts at build time (no runtime request to Google's CDN, no
// layout shift from a late-loading web font).

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

const plexLatin = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-latin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BARQ",
  description: "BARQ — Smart Tourism Operations Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${plexLatin.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
