import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

// [locale] segment layout — BARQ Internationalization, Phase 0.
//
// PHASE 0 VALIDATION SCOPE ONLY: this segment exists to prove the
// full routing/middleware/message-loading/type-safety stack works
// end-to-end, not to host real migrated pages yet — no existing route
// (dashboard, services, bookings, provider) is nested under here in
// this phase, per explicit "do not move route files" scope. The real
// page migration is later-phase work (Phases B-D of the approved
// architecture analysis).
//
// This is a NESTED layout under the existing root layout
// (src/app/layout.tsx), which still owns <html>/<body> — this file
// adds only locale validation.
//
// NextIntlClientProvider REMOVED HERE (Phase A.1): it now lives at
// the true root layout (src/app/layout.tsx) instead, covering the
// entire app, not just this validation subtree — keeping it here too
// would be a redundant, nested provider. setRequestLocale below still
// runs for this segment specifically (its own optimization, unrelated
// to the provider boundary).
//
// Invalid locale segments (e.g. /xx) are NOT silently accepted: any
// value not in routing.locales triggers notFound(), consistent with
// this project's existing uniform-404 conventions elsewhere.

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enables next-intl's static-rendering optimization for this locale
  // segment — a no-op for correctness, a real one for build performance
  // once real pages exist here.
  setRequestLocale(locale);

  return children;
}
