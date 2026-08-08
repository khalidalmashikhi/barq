import "./globals.css";
import { Link } from "@/i18n/navigation";
import { Compass } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { defaultLocale, getLocaleDirection } from "@/i18n/locales";
import { plexArabic, plexLatin } from "./fonts";

// Site-wide 404 (true root) — catches genuinely unmatched routes and invalid
// locale segments (/xyz), the latter thrown by src/app/[locale]/layout.tsx's
// hasLocale() check, which Next.js resolves at this parent boundary.
//
// RENDERS ITS OWN <html>/<body> (BARQ i18n stabilization): the root layout
// (src/app/layout.tsx) is now a pass-through with no <html>/<body> — those
// moved into the [locale] layout — so this root-level boundary, which renders
// OUTSIDE any [locale] segment, must supply its own. Locale here resolves to
// the default (Arabic) via next-intl's request config fallback for an
// unresolved/invalid segment, so lang/dir use defaultLocale to match the
// translated text getServerTranslator returns.

export default async function NotFound() {
  const t = await getServerTranslator("common");

  return (
    <html
      lang={defaultLocale}
      dir={getLocaleDirection(defaultLocale)}
      className={`${plexArabic.variable} ${plexLatin.variable}`}
    >
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <Compass size={40} strokeWidth={1.5} className="text-foreground/25" />
          <h1 className="text-xl font-semibold text-foreground">{t("notFoundTitle")}</h1>
          <p className="text-sm text-foreground/50">{t("notFoundDescription")}</p>
          <Link
            href="/"
            className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("backToHomeButton")}
          </Link>
        </main>
      </body>
    </html>
  );
}
