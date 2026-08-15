import { COUNTRIES, type Country } from "./registry";

// Local, fast, API-free country search for the picker. Matches on ALL of:
//   - English name        ("Oman", "oman")
//   - Arabic/localized name ("عمان", "عُمان")  — diacritic/alef-tolerant
//   - ISO alpha-2 code     ("OM", "om")
//   - calling code         ("+968", "968")
// Case-insensitive and whitespace-tolerant. Pure/isomorphic — no network per
// keystroke; the caller just filters the in-memory list.

// Strip Arabic diacritics (tashkeel), tatweel, and normalize common letter
// variants so a query without diacritics still matches a stored name that has
// them (e.g. "عمان" matches "عُمان"), and alef/ya/ta-marbuta variants unify.
function normalizeArabic(value: string): string {
  return value
    .replace(/[ً-ْٰـ]/g, "") // harakat + superscript alef + tatweel
    .replace(/[آأإ]/g, "ا") // آ أ إ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ة/g, "ه") // ة → ه
    .trim();
}

/** Search the country list. An empty/whitespace query returns the full list unchanged. */
export function searchCountries(query: string, countries: readonly Country[] = COUNTRIES): Country[] {
  const raw = query.trim();
  if (!raw) return [...countries];

  const lower = raw.toLowerCase();
  const arQuery = normalizeArabic(raw);
  const digits = raw.replace(/\D/g, ""); // for "+968" / "968" / "00968"

  return countries.filter((c) => {
    if (c.nameEn.toLowerCase().includes(lower)) return true;
    if (arQuery && normalizeArabic(c.nameAr).includes(arQuery)) return true;
    if (c.iso.toLowerCase().includes(lower)) return true;

    if (digits) {
      const codeDigits = c.callingCode.replace(/\D/g, ""); // "968"
      if (codeDigits.startsWith(digits) || digits.startsWith(codeDigits)) return true;
    }
    if (c.callingCode.includes(raw)) return true; // literal "+968"

    return false;
  });
}
