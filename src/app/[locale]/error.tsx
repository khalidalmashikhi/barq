"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Page-level error boundary — Phase D.3 (Production Hardening).
//
// Catches errors thrown by pages and nested layouts UNDER the [locale]
// segment (every real route in this app — Dashboard, Bookings,
// Provider, Notifications, the public marketplace). Does NOT catch an
// error thrown by [locale]/layout.tsx itself, or by the true root
// layout — those bubble to src/app/global-error.tsx instead, per
// Next.js's own error-boundary nesting rules (an error.tsx cannot
// catch an error thrown in its own segment's layout, only in that
// layout's children).
//
// NEVER EXPOSES THE RAW ERROR: only a generic, translated message is
// shown — `error.message`/`error.stack` are deliberately never
// rendered. The error is logged to the browser console only (already
// visible there via the browser's own devtools regardless of this
// boundary, and carries no more information than that) — this project
// has no third-party error-tracking service to forward to yet (a
// documented Phase D.2 follow-up), and this component intentionally
// does not invent one.
//
// MUST BE "use client": Next.js requires every error.tsx to be a
// Client Component so it can receive the reset() callback and manage
// its own retry state.

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // Server-side rendering errors are already logged by Next.js's own
    // server console; this logs the client-visible occurrence
    // (including Next.js's own `digest` correlation id, not the full
    // message/stack) so the two can be correlated later once real
    // error tracking exists — no additional detail is captured here.
    console.error("[error-boundary]", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle size={40} strokeWidth={1.5} className="text-danger/60" />
      <h1 className="text-xl font-semibold text-foreground">{t("errorTitle")}</h1>
      <p className="text-sm text-foreground/50">{t("errorDescription")}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("tryAgainButton")}
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/15"
        >
          {t("backToHomeButton")}
        </Link>
      </div>
    </main>
  );
}
