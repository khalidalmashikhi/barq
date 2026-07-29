import { Link } from "@/i18n/navigation";
import { Compass } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Notification Center / feature-page 404 boundary — Phase D.2 (Admin &
// Production Readiness).
//
// Catches notFound() calls thrown by pages NESTED under a valid
// locale segment that have no more specific boundary of their own
// (e.g. bookings/[id]/page.tsx's own notFound() for a missing/foreign
// booking) — this segment's OWN layout.tsx (src/app/[locale]/layout.tsx)
// throwing notFound() for an invalid locale does NOT resolve here; per
// Next.js's boundary rules a segment's own layout throwing notFound()
// bubbles to the PARENT segment's boundary instead — verified live,
// see src/app/not-found.tsx's own comment for the full story and why
// that file (the true root) exists alongside this one rather than
// instead of it.
//
// LOCALE-SAFE: getServerTranslator resolves through next-intl's own
// request config (src/i18n/request.ts), which already falls back to
// routing.defaultLocale for any unresolved/invalid locale.

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
