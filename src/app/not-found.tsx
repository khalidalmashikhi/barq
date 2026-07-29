import { Link } from "@/i18n/navigation";
import { Compass } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Site-wide 404 — Phase D.2 (Admin & Production Readiness).
//
// REAL GAP FOUND AND FIXED: no not-found.tsx existed anywhere above
// the two feature-scoped ones (services/[id], provider/services/[id])
// — any genuinely unmatched route (a typo'd path, an invalid locale
// segment) fell through to Next.js's own generic, unbranded,
// unlocalized default 404.
//
// MUST BE AT THE TRUE ROOT, NOT INSIDE [locale]: verified live —
// src/app/[locale]/layout.tsx itself throws notFound() for an invalid
// locale segment, and Next.js resolves a segment's OWN layout throwing
// notFound() at the PARENT segment's boundary, not a sibling
// not-found.tsx at the same level as that layout. A first attempt at
// src/app/[locale]/not-found.tsx compiled fine but was never actually
// invoked for either an invalid locale (/xyz) or a genuinely unmatched
// path (/en/nonexistent) — confirmed via the dev server's own compile
// log, which showed Next.js falling back to its built-in `/_not-found`
// route both times. This file (the true root, the parent of [locale])
// is what Next.js actually uses for both cases. Kept alongside
// src/app/[locale]/not-found.tsx (not removed) since that one still
// correctly catches notFound() calls thrown by pages NESTED under a
// valid locale that have no more specific boundary of their own (e.g.
// bookings/[id]/page.tsx's own notFound() for a missing booking) —
// the two are not redundant, they catch different boundary levels.
//
// LOCALE-SAFE EVEN FOR AN INVALID LOCALE SEGMENT: getServerTranslator
// resolves through next-intl's own request config (src/i18n/request.ts),
// which already falls back to routing.defaultLocale for any
// unresolved/invalid locale — this page needs no special-case handling
// of its own for that case.

export default async function NotFound() {
  const t = await getServerTranslator("common");

  return (
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
  );
}
