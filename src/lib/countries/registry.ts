// Country metadata for the global-ready phone-entry UI — one source of truth for
// the picker (never scattered across components). Pure, isomorphic data (no
// server-only): reusable by the web login now and a future mobile API.
//
// AUTHENTICATION IS OMAN-ONLY for now. The UI is globally structured, but exactly
// ONE country has `authSupported: true` (Oman). Every other country is shown as
// "coming soon" and can NEVER trigger send-otp (enforced in phone-entry.ts and
// again server-side by P0-1). Enabling another country later is deliberately a
// TWO-part change that must happen together: flip `authSupported` here AND wire a
// server-side canonicalizer for that country's numbers (see phone-entry.ts).
//
// This is a curated, hand-verified subset (not an exhaustive ISO list): the GCC,
// wider MENA, major tourist-source markets, and BARQ's 8 UI locales — enough to
// feel global and exercise the picker, with accurate Arabic names. Adding a row is
// trivial. Flags are DERIVED from `iso` (see flag.ts), never stored.

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase. */
  iso: string;
  /** E.164 calling code WITH the leading '+', e.g. "+968". */
  callingCode: string;
  nameEn: string;
  /** Arabic (localized) country name. */
  nameAr: string;
  /** Whether BARQ phone authentication is currently supported for this country. */
  authSupported: boolean;
}

// Oman first (default + the only auth-supported country), then the rest grouped
// roughly by region. `authSupported` is false everywhere except Oman.
export const COUNTRIES: readonly Country[] = [
  { iso: "OM", callingCode: "+968", nameEn: "Oman", nameAr: "عُمان", authSupported: true },

  // GCC
  { iso: "SA", callingCode: "+966", nameEn: "Saudi Arabia", nameAr: "السعودية", authSupported: false },
  { iso: "AE", callingCode: "+971", nameEn: "United Arab Emirates", nameAr: "الإمارات العربية المتحدة", authSupported: false },
  { iso: "QA", callingCode: "+974", nameEn: "Qatar", nameAr: "قطر", authSupported: false },
  { iso: "KW", callingCode: "+965", nameEn: "Kuwait", nameAr: "الكويت", authSupported: false },
  { iso: "BH", callingCode: "+973", nameEn: "Bahrain", nameAr: "البحرين", authSupported: false },

  // Wider MENA
  { iso: "YE", callingCode: "+967", nameEn: "Yemen", nameAr: "اليمن", authSupported: false },
  { iso: "JO", callingCode: "+962", nameEn: "Jordan", nameAr: "الأردن", authSupported: false },
  { iso: "EG", callingCode: "+20", nameEn: "Egypt", nameAr: "مصر", authSupported: false },
  { iso: "LB", callingCode: "+961", nameEn: "Lebanon", nameAr: "لبنان", authSupported: false },
  { iso: "IQ", callingCode: "+964", nameEn: "Iraq", nameAr: "العراق", authSupported: false },
  { iso: "SY", callingCode: "+963", nameEn: "Syria", nameAr: "سوريا", authSupported: false },
  { iso: "PS", callingCode: "+970", nameEn: "Palestine", nameAr: "فلسطين", authSupported: false },
  { iso: "MA", callingCode: "+212", nameEn: "Morocco", nameAr: "المغرب", authSupported: false },
  { iso: "TN", callingCode: "+216", nameEn: "Tunisia", nameAr: "تونس", authSupported: false },
  { iso: "DZ", callingCode: "+213", nameEn: "Algeria", nameAr: "الجزائر", authSupported: false },
  { iso: "SD", callingCode: "+249", nameEn: "Sudan", nameAr: "السودان", authSupported: false },
  { iso: "LY", callingCode: "+218", nameEn: "Libya", nameAr: "ليبيا", authSupported: false },
  { iso: "TR", callingCode: "+90", nameEn: "Türkiye", nameAr: "تركيا", authSupported: false },
  { iso: "IR", callingCode: "+98", nameEn: "Iran", nameAr: "إيران", authSupported: false },

  // Europe (incl. BARQ UI locales)
  { iso: "GB", callingCode: "+44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة", authSupported: false },
  { iso: "DE", callingCode: "+49", nameEn: "Germany", nameAr: "ألمانيا", authSupported: false },
  { iso: "FR", callingCode: "+33", nameEn: "France", nameAr: "فرنسا", authSupported: false },
  { iso: "IT", callingCode: "+39", nameEn: "Italy", nameAr: "إيطاليا", authSupported: false },
  { iso: "ES", callingCode: "+34", nameEn: "Spain", nameAr: "إسبانيا", authSupported: false },
  { iso: "NL", callingCode: "+31", nameEn: "Netherlands", nameAr: "هولندا", authSupported: false },
  { iso: "CH", callingCode: "+41", nameEn: "Switzerland", nameAr: "سويسرا", authSupported: false },
  { iso: "SE", callingCode: "+46", nameEn: "Sweden", nameAr: "السويد", authSupported: false },
  { iso: "PL", callingCode: "+48", nameEn: "Poland", nameAr: "بولندا", authSupported: false },
  { iso: "CZ", callingCode: "+420", nameEn: "Czechia", nameAr: "التشيك", authSupported: false },
  { iso: "RU", callingCode: "+7", nameEn: "Russia", nameAr: "روسيا", authSupported: false },
  { iso: "GR", callingCode: "+30", nameEn: "Greece", nameAr: "اليونان", authSupported: false },
  { iso: "PT", callingCode: "+351", nameEn: "Portugal", nameAr: "البرتغال", authSupported: false },

  // Americas
  { iso: "US", callingCode: "+1", nameEn: "United States", nameAr: "الولايات المتحدة", authSupported: false },
  { iso: "CA", callingCode: "+1", nameEn: "Canada", nameAr: "كندا", authSupported: false },
  { iso: "BR", callingCode: "+55", nameEn: "Brazil", nameAr: "البرازيل", authSupported: false },

  // Asia-Pacific
  { iso: "IN", callingCode: "+91", nameEn: "India", nameAr: "الهند", authSupported: false },
  { iso: "PK", callingCode: "+92", nameEn: "Pakistan", nameAr: "باكستان", authSupported: false },
  { iso: "BD", callingCode: "+880", nameEn: "Bangladesh", nameAr: "بنغلاديش", authSupported: false },
  { iso: "LK", callingCode: "+94", nameEn: "Sri Lanka", nameAr: "سريلانكا", authSupported: false },
  { iso: "PH", callingCode: "+63", nameEn: "Philippines", nameAr: "الفلبين", authSupported: false },
  { iso: "ID", callingCode: "+62", nameEn: "Indonesia", nameAr: "إندونيسيا", authSupported: false },
  { iso: "MY", callingCode: "+60", nameEn: "Malaysia", nameAr: "ماليزيا", authSupported: false },
  { iso: "TH", callingCode: "+66", nameEn: "Thailand", nameAr: "تايلاند", authSupported: false },
  { iso: "SG", callingCode: "+65", nameEn: "Singapore", nameAr: "سنغافورة", authSupported: false },
  { iso: "CN", callingCode: "+86", nameEn: "China", nameAr: "الصين", authSupported: false },
  { iso: "JP", callingCode: "+81", nameEn: "Japan", nameAr: "اليابان", authSupported: false },
  { iso: "KR", callingCode: "+82", nameEn: "South Korea", nameAr: "كوريا الجنوبية", authSupported: false },
  { iso: "AU", callingCode: "+61", nameEn: "Australia", nameAr: "أستراليا", authSupported: false },

  // Africa (sub-Saharan)
  { iso: "ZA", callingCode: "+27", nameEn: "South Africa", nameAr: "جنوب إفريقيا", authSupported: false },
  { iso: "KE", callingCode: "+254", nameEn: "Kenya", nameAr: "كينيا", authSupported: false },
  { iso: "NG", callingCode: "+234", nameEn: "Nigeria", nameAr: "نيجيريا", authSupported: false },
] as const;

/** The default country for BARQ's phone entry (Oman — the only auth-supported one). */
export const DEFAULT_COUNTRY: Country = COUNTRIES[0]!;

/** Look up a country by ISO alpha-2 (case-insensitive). */
export function findCountryByIso(iso: string): Country | undefined {
  const target = iso.trim().toUpperCase();
  return COUNTRIES.find((c) => c.iso === target);
}
