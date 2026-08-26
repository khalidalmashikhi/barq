"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { COUNTRIES, type Country } from "@/lib/countries/registry";
import { searchCountries } from "@/lib/countries/search";
import { isoToFlagEmoji } from "@/lib/countries/flag";
import { clsx } from "@/components/ui/clsx";

// Global-ready country picker — a searchable overlay used by PhoneNumberInput.
// Mobile-first: a bottom-sheet on small screens, a centered dialog on desktop
// (responsive utility classes only — no new design system). Search is LOCAL and
// API-free (searchCountries): matches English name, Arabic name, ISO code, and
// calling code (with/without '+'). Authentication is INTERNATIONAL: every listed
// country is selectable (authSupported is true across the registry). The disabled /
// "coming soon" row treatment below is retained defensively for any country a future
// gate flags unsupported (currently none). No IP/geo detection.

interface CountryPickerProps {
  open: boolean;
  selectedIso: string;
  onSelect: (country: Country) => void;
  onClose: () => void;
}

export function CountryPicker({ open, selectedIso, onSelect, onClose }: CountryPickerProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Mount guard so the portal only renders client-side (document.body exists),
  // avoiding any SSR/hydration mismatch. The overlay is a full-viewport surface, so
  // it is portaled to <body> — otherwise `position: fixed` would resolve against the
  // login Card's transform (animate-fade-up) instead of the viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const results = useMemo(() => searchCountries(query), [query]);

  // Reset the query and focus the search each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const localizedName = (c: Country) => (locale === "ar" ? c.nameAr : c.nameEn);
  const secondaryName = (c: Country) => (locale === "ar" ? c.nameEn : c.nameAr);

  // Portaled to <body> so the fixed overlay is positioned against the VIEWPORT,
  // not the transformed login Card — a true full-screen bottom-sheet / dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("selectCountry")}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t("closePicker")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-foreground/40 backdrop-blur-sm"
      />

      {/* Panel: bottom-sheet on mobile, dialog on desktop */}
      <div className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-premium-lg animate-fade-up sm:m-4 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <h2 className="text-base font-semibold text-foreground">{t("selectCountry")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closePicker")}
            className="rounded-lg p-1.5 text-foreground/60 transition-colors hover:bg-accent/30 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ✕
            </span>
          </button>
        </div>

        <div className="px-4 pb-3 pt-3">
          <input
            ref={searchRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // The picker renders inside the login <form>; Enter in a search field
            // would otherwise submit it. Swallow Enter so searching a country can
            // never accidentally trigger send-otp.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder={t("searchCountry")}
            aria-label={t("searchCountry")}
            className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" role="listbox" aria-label={t("selectCountry")}>
          {results.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-foreground/50">{t("noCountryResults")}</li>
          )}
          {results.map((c) => {
            const selected = c.iso === selectedIso;
            const disabled = !c.authSupported;
            return (
              <li key={c.iso}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(c);
                    onClose();
                  }}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
                    disabled
                      ? "cursor-not-allowed opacity-55"
                      : "hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-primary/20",
                    selected && !disabled && "bg-accent/40"
                  )}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">
                    {isoToFlagEmoji(c.iso)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{localizedName(c)}</span>
                    <span className="block truncate text-xs text-foreground/50" dir="ltr">
                      {c.iso} · {c.callingCode}
                      <span className="mx-1 text-foreground/30">·</span>
                      <span dir={locale === "ar" ? "rtl" : "ltr"}>{secondaryName(c)}</span>
                    </span>
                  </span>
                  {disabled ? (
                    <span className="shrink-0 rounded-full bg-accent/50 px-2 py-0.5 text-[11px] font-medium text-foreground/60">
                      {t("comingSoon")}
                    </span>
                  ) : (
                    selected && (
                      <span aria-hidden="true" className="shrink-0 text-primary">
                        ✓
                      </span>
                    )
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}

// Re-export for convenience so callers can `import { COUNTRIES }` from one place if
// they already depend on this module (keeps the picker the UI entry point).
export { COUNTRIES };
