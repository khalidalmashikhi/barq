"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { locales, type Locale } from "@/i18n/locales";
import { switchLocalePath } from "@/i18n/switch-locale-path";

// Language switcher — Phase 2 navbar revision (Brand Identity Reset).
//
// The public navbar previously had no working language control at all
// (the only existing "languageAriaLabel" consumer, AppTopBar's Globe
// button, is a decorative placeholder with no dropdown/action — see
// its own file). This is the first real, functional one: a compact
// dropdown that switches locale.
//
// LOCALE-SWITCH CORRECTNESS: the target href is built by the
// deterministic `switchLocalePath` helper (src/i18n/switch-locale-path.ts)
// from the FULL current path (locale segment included), then navigated to
// with a plain next/link `<Link>`. This deliberately does NOT use
// next-intl's `usePathname()` + `<Link locale>` pairing: that pairing
// strips only the *current* locale (and only when `useLocale()` agrees
// with the URL) and then unconditionally prepends a locale, which is what
// produced doubled roots like `/de/en` or `/fr/fr` whenever the two
// diverged or the URL already carried a stray locale. The helper instead
// strips every leading locale segment and prepends exactly one target —
// self-healing an already-doubled URL — while preserving the route, query
// string and hash. A plain next/link is required here: next-intl's own
// `Link` would re-prefix the already-locale-complete href and re-introduce
// the duplication.
//
// Native-script display names, not English names for each language —
// a Czech speaker should see "Čeština", not "Czech".

const LOCALE_NAMES: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  pl: "Polski",
  fr: "Français",
  cs: "Čeština",
  ru: "Русский",
};

type LanguageSwitcherProps = {
  onSelect?: () => void;
};

export function LanguageSwitcher({ onSelect }: LanguageSwitcherProps = {}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale() as Locale;
  // Full current path INCLUDING the locale segment (e.g. `/de/services`).
  // next/navigation's usePathname is used deliberately (not next-intl's) so
  // the value is deterministic and independent of locale negotiation — the
  // `switchLocalePath` helper does the locale replacement itself.
  const pathname = usePathname();
  // Query string + hash are only available on the client. Reading them from
  // window (post-mount) rather than useSearchParams avoids forcing a
  // Suspense boundary on every page that renders the navbar, while still
  // preserving `?query` and `#hash` across a locale switch. The initial
  // (server) render links to the bare path; the effect fills in the suffix.
  const [locationSuffix, setLocationSuffix] = useState("");
  const t = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocationSuffix(window.location.search + window.location.hash);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentPath = `${pathname}${locationSuffix}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("languageAriaLabel")}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/15 hover:text-foreground"
      >
        <Globe size={16} strokeWidth={1.75} aria-hidden />
        <span>{LOCALE_NAMES[locale]}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute start-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-2xl border border-border bg-card py-1.5 shadow-premium-lg sm:start-auto sm:end-0"
        >
          {locales.map((code) => (
            <Link
              key={code}
              href={switchLocalePath(currentPath, code)}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect?.();
              }}
              className={`flex items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-accent/15 ${
                code === locale ? "font-medium text-primary" : "text-foreground/70"
              }`}
            >
              {LOCALE_NAMES[code]}
              {code === locale && <Check size={14} strokeWidth={2} aria-hidden />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
