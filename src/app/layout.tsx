import type { Metadata } from "next";
import "./globals.css";

// This root layout sets Arabic as the default language and RTL as the
// default direction, per ADR-0005 (Bilingual by Design) and
// PROJECT_MANIFEST.md Core Value 4 (Arabic-first). Full locale negotiation
// (stored user preference → request-level negotiation → Arabic default),
// per LOCALIZATION.md §3, is a follow-up implementation task — this initial
// scaffold intentionally does not invent that mechanism ahead of its own
// specification being implemented.

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
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
