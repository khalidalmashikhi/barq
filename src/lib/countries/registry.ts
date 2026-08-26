// Country metadata for the global customer-auth phone-entry UI — one source of truth
// for the picker (never scattered across components). Pure, isomorphic data (no
// server-only): reusable by the web login now and a future mobile API.
//
// FULL INTERNATIONAL COVERAGE (AUTH-INTERNATIONAL-COUNTRY-COVERAGE-1). This list is
// DERIVED, not hand-maintained: every country/territory libphonenumber-js supports
// (`getCountries()`) is included, with its calling code from the same authority
// (`getCountryCallingCode`) and its localized display name from the runtime CLDR data
// (`Intl.DisplayNames`, English + Arabic). There is no handwritten dialing rule and no
// hand-typed country-name table — adding coverage means bumping libphonenumber-js, not
// editing an array. Flags are DERIVED from `iso` (see flag.ts), never stored.
//
// This registry is used ONLY by the customer authentication phone entry
// (src/components/auth/*). It is NOT a business/market whitelist and no BARQ domain
// feature keys off its membership; the number itself is validated/normalized to E.164
// by libphonenumber-js (see normalize-international-phone.ts). `authSupported` is kept
// as a per-country gate but is true for all rows — validity, not list membership, is
// what decides whether a number can request an OTP.

import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase — the authoritative selection key (also for shared
   *  calling codes, e.g. +1 US vs CA vs the Caribbean). */
  iso: string;
  /** E.164 calling code WITH the leading '+', e.g. "+968". Display-only; may be shared. */
  callingCode: string;
  /** English (CLDR) country name. */
  nameEn: string;
  /** Arabic (CLDR, localized) country name. */
  nameAr: string;
  /** Whether BARQ phone authentication is currently supported for this country. */
  authSupported: boolean;
}

/** BARQ's default country for phone entry. */
const DEFAULT_ISO = "OM";

// CLDR display-name resolvers (English + Arabic). Built once; deterministic across a
// given JS engine. Names are only ever RENDERED inside the client-only CountryPicker,
// so engine-to-engine CLDR string differences can never cause an SSR hydration
// mismatch (the login trigger shows the flag + calling code, never the name).
const EN_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const AR_NAMES = new Intl.DisplayNames(["ar"], { type: "region" });

function displayName(names: Intl.DisplayNames, iso: string): string {
  try {
    return names.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

function buildCountry(iso: CountryCode): Country {
  let callingCode = "";
  try {
    callingCode = `+${getCountryCallingCode(iso)}`;
  } catch {
    callingCode = "";
  }
  return {
    iso,
    callingCode,
    nameEn: displayName(EN_NAMES, iso),
    nameAr: displayName(AR_NAMES, iso),
    authSupported: true,
  };
}

// Every libphonenumber-js country/territory, built from the authority. Oman first (the
// default), then the rest alphabetically by English name for predictable scanning — the
// picker is searchable, so ordering is only a scan convenience.
export const COUNTRIES: readonly Country[] = (() => {
  const all = getCountries()
    .map(buildCountry)
    .filter((c) => c.callingCode !== "");
  const oman = all.find((c) => c.iso === DEFAULT_ISO);
  const rest = all
    .filter((c) => c.iso !== DEFAULT_ISO)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn, "en"));
  return oman ? [oman, ...rest] : rest;
})();

/** The default country for BARQ's phone entry (Oman — the default, not the only one). */
export const DEFAULT_COUNTRY: Country = findCountryByIso(DEFAULT_ISO) ?? COUNTRIES[0]!;

/** Look up a country by ISO alpha-2 (case-insensitive). */
export function findCountryByIso(iso: string): Country | undefined {
  const target = iso.trim().toUpperCase();
  return COUNTRIES.find((c) => c.iso === target);
}
