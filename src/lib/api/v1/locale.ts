import { isValidLocale, defaultLocale, type Locale } from "@/i18n/locales";

// API v1 locale resolution — Gate 1 (Public API Foundation).
//
// BARQ Web resolves locale from the `[locale]` URL segment via next-intl's
// request scope (getLocale()). API routes are NOT under `[locale]` and are
// excluded from the next-intl middleware, so getLocale() there would always
// fall back to the default (`ar`). This helper is the ONE place `/api/v1`
// resolves the caller's locale, from the request itself, with the priority the
// Gate-1 contract fixes:
//
//   1. explicit `?locale=` query parameter (validated against the 8 BARQ
//      locales via the existing isValidLocale)
//   2. Accept-Language negotiation (highest-q tag whose primary subtag is a
//      supported BARQ locale)
//   3. BARQ default locale (`ar`, from src/i18n/locales.ts — single source of
//      truth, never re-declared here)
//
// It reuses isValidLocale/defaultLocale from the existing locale source of
// truth and never hardcodes an Arabic/English-only assumption.

/**
 * Negotiate an Accept-Language header down to a supported BARQ Locale, honoring
 * q-weights. Returns undefined when no listed language maps to a BARQ locale.
 */
export function negotiateAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined;

  const ranked = header
    .split(",")
    .map((part) => {
      const segments = part.trim().split(";");
      const tag = (segments[0] ?? "").trim().toLowerCase();
      const qParam = segments
        .slice(1)
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const qValue = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag, q: Number.isFinite(qValue) ? qValue : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0] ?? tag;
    if (isValidLocale(primary)) return primary;
  }

  return undefined;
}

/**
 * Resolve the effective locale for an `/api/v1` request: explicit `?locale=`
 * query param → Accept-Language → default (`ar`). The returned value is always
 * one of the 8 supported BARQ locales.
 */
export function resolveApiLocale(request: Request): Locale {
  const url = new URL(request.url);
  const queryLocale = url.searchParams.get("locale");
  if (queryLocale && isValidLocale(queryLocale)) return queryLocale;

  const negotiated = negotiateAcceptLanguage(request.headers.get("accept-language"));
  if (negotiated) return negotiated;

  return defaultLocale;
}
