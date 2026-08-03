import { locales, type Locale } from "./locales";

// Deterministic locale-path normalizer — BARQ Internationalization.
//
// WHY THIS EXISTS: the language switcher previously relied on next-intl's
// `usePathname()` (which strips only the *current* locale, and only when
// `useLocale()` agrees with the URL's leading segment) together with
// `<Link locale>` (which unconditionally *prepends* a locale). Whenever
// those two diverged — or the URL already carried a stray/duplicate
// locale segment — the result was two locale segments (e.g. `/de/en`,
// `/pl/it`, `/fr/fr`). There was no normalization step that could ever
// heal an already-doubled path.
//
// This helper removes that fragility with a single pure, exhaustively
// testable rule set:
//   1. Strip EVERY leading, consecutive, valid-locale segment (so an
//      already-doubled `/de/en` collapses to nothing, not one leftover).
//   2. Prepend EXACTLY ONE target locale.
//   3. Preserve the remaining route, the query string, and the hash.
//
// It intentionally strips only *leading* locale segments — a later
// segment that merely happens to equal a locale code (say a future
// `/en/some/en` route) is real path data and is left untouched. BARQ has
// no top-level route named after a locale code, so leading-run stripping
// only ever removes true locale prefixes.

const LOCALE_SEGMENTS: ReadonlySet<string> = new Set(locales);

/**
 * Rebuild a URL path so it carries exactly one locale segment
 * (`targetLocale`), preserving the route, query string and hash.
 *
 * @param currentPath a path that may include a leading locale prefix,
 *   zero or more *duplicate* leading locale prefixes, a `?query` and/or a
 *   `#hash` (e.g. `/de/en/services?x=1#top`). Anything the browser puts
 *   in `location.pathname + location.search + location.hash`.
 * @param targetLocale the locale to switch to.
 * @returns a normalized path such as `/it/services?x=1#top` — always with
 *   a single valid locale root and never two consecutive locale segments.
 */
export function switchLocalePath(currentPath: string, targetLocale: Locale): string {
  // Peel the hash off first, then the query, so neither can be mistaken
  // for part of a path segment.
  const hashIndex = currentPath.indexOf("#");
  const hash = hashIndex >= 0 ? currentPath.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? currentPath.slice(0, hashIndex) : currentPath;

  const queryIndex = beforeHash.indexOf("?");
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";
  const pathnameOnly = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;

  const segments = pathnameOnly.split("/").filter((segment) => segment.length > 0);

  // Drop the leading run of locale segments (handles the duplicate case).
  while (segments.length > 0 && LOCALE_SEGMENTS.has(segments[0]!)) {
    segments.shift();
  }

  const rest = segments.join("/");
  const normalizedPath = rest.length > 0 ? `/${targetLocale}/${rest}` : `/${targetLocale}`;

  return `${normalizedPath}${query}${hash}`;
}
