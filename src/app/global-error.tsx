"use client";

import { useEffect } from "react";

// Root-layout error boundary — Phase D.3 (Production Hardening).
//
// Catches an error thrown by the TRUE ROOT layout itself
// (src/app/layout.tsx) — the one failure class [locale]/error.tsx
// cannot catch, since an error.tsx never catches an error thrown by
// its own segment's layout. Per Next.js's own documented requirement,
// global-error.tsx REPLACES the root layout entirely when it renders,
// so it must define its own <html>/<body> — the ones in
// src/app/layout.tsx are not available at this point, because that
// layout is what failed.
//
// NO next-intl HERE, DELIBERATELY: NextIntlClientProvider is mounted
// BY the root layout (src/app/layout.tsx) — if that layout is what
// threw, the provider was never mounted, so useTranslations()/
// useLocale() have nothing to read from and would themselves throw.
// This is a genuine Next.js framework constraint, not an oversight or
// a regression of this project's i18n coverage: a plain, neutral
// English+Arabic message is the correct, honest fallback for a
// failure this catastrophic, not a mistranslated or crashing attempt
// at real localization.
//
// NEVER EXPOSES THE RAW ERROR: same discipline as
// src/app/[locale]/error.tsx — only `error.digest` (Next.js's own
// opaque correlation id) is logged, never `error.message`/`error.stack`.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Phase 5.2 (Production Hardening) — this boundary previously never
    // logged anything at all, unlike its sibling src/app/[locale]/error.tsx,
    // which does. Same discipline as that sibling: only the opaque
    // digest is logged, never error.message/error.stack. Cannot use
    // src/lib/logger.ts here — it's "server-only" and this is a Client
    // Component, exactly like the sibling boundary's own console.error.
    console.error("[global-error]", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <main
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            An unexpected error occurred. Please try again.
          </p>
          <p dir="rtl" style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "0.5rem",
              borderRadius: "9999px",
              padding: "0.625rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#fff",
              backgroundColor: "#111827",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try Again / حاول مرة أخرى
          </button>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Reference: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
