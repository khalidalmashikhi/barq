"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/locales";

// Language switcher — Phase 2 navbar revision (Brand Identity Reset).
//
// The public navbar previously had no working language control at all
// (the only existing "languageAriaLabel" consumer, AppTopBar's Globe
// button, is a decorative placeholder with no dropdown/action — see
// its own file). This is the first real, functional one: a compact
// dropdown that switches locale via next-intl's own Link+locale
// mechanism (same pathname, different locale prefix) — no client-side
// routing logic invented, just the documented next-intl pattern.
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
  const pathname = usePathname();
  const t = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
              href={pathname}
              locale={code}
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
