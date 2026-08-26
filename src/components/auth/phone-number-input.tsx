"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type Country } from "@/lib/countries/registry";
import { isoToFlagEmoji } from "@/lib/countries/flag";
import { CountryPicker } from "./country-picker";
import { clsx } from "@/components/ui/clsx";

// Global-ready phone entry: a single cohesive field made of a country trigger
// [flag · calling code · ▼] and a national-number input — so the user never
// retypes "+968". Tapping the country section opens the searchable CountryPicker.
//
// INTERNATIONAL AUTH: this component only presents the country; it never decides
// whether a number is sendable — that is resolveAuthPhone()/canRequestOtp() in
// phone-entry.ts (the shared libphonenumber-js authority), consulted by the parent
// form. The "not available yet" note is retained defensively for any country flagged
// unsupported (currently none). The calling code and number are always shown LTR
// (numerals read left-to-right in every locale).

interface PhoneNumberInputProps {
  country: Country;
  nationalNumber: string;
  onCountryChange: (country: Country) => void;
  onNationalNumberChange: (value: string) => void;
  disabled?: boolean;
  /** id for the national input, so an external <label htmlFor> can point at it. */
  inputId?: string;
}

export function PhoneNumberInput({
  country,
  nationalNumber,
  onCountryChange,
  onNationalNumberChange,
  disabled = false,
  inputId = "phoneNumber",
}: PhoneNumberInputProps) {
  const t = useTranslations("auth");
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div
        className={clsx(
          "flex items-stretch overflow-hidden rounded-xl border border-border bg-background/60 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
          disabled && "opacity-60"
        )}
      >
        {/* Country trigger — opens the picker. LTR content (flag + code). */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={`${t("country")}: ${country.iso} ${country.callingCode}`}
          className="flex shrink-0 items-center gap-1.5 border-e border-border px-3 py-3 text-foreground transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/20"
          dir="ltr"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            {isoToFlagEmoji(country.iso)}
          </span>
          <span className="text-sm font-medium tabular-nums">{country.callingCode}</span>
          <span aria-hidden="true" className="text-xs text-foreground/50">
            ▾
          </span>
        </button>

        {/* National number — always LTR numerals. */}
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required
          disabled={disabled}
          value={nationalNumber}
          onChange={(e) => onNationalNumberChange(e.target.value)}
          placeholder={t("phonePlaceholder")}
          dir="ltr"
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-start text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </div>

      {!country.authSupported && (
        <p role="status" className="text-sm text-foreground/60">
          {t("phoneAuthNotAvailable")}
        </p>
      )}

      <CountryPicker
        open={pickerOpen}
        selectedIso={country.iso}
        onSelect={onCountryChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
