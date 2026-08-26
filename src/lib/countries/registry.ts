// Country metadata for the global-ready phone-entry UI — one source of truth for
// the picker (never scattered across components). Pure, isomorphic data (no
// server-only): reusable by the web login now and a future mobile API.
//
// AUTHENTICATION IS INTERNATIONAL (AUTH-INTERNATIONAL-PHONE-1). Every listed
// country is `authSupported: true`: the customer selects their country and enters a
// NATIONAL number, and the shared authority canonicalizes it to E.164 and validates
// it with libphonenumber-js metadata (see normalize-international-phone.ts, consulted
// by phone-entry.ts and again server-side). Oman remains only the DEFAULT country
// (DEFAULT_COUNTRY), not the only one. `authSupported` is retained as a per-country
// gate for the picker but is currently true everywhere; validity (not membership in
// this list) is what actually decides whether a number can request an OTP.
//
// This is a curated, hand-verified subset (not an exhaustive ISO list): the GCC,
// wider MENA, major tourist-source markets, and BARQ's 8 UI locales — accurate
// Arabic names, enough to feel global. Adding a row is trivial. Flags are DERIVED
// from `iso` (see flag.ts), never stored.

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

// Oman first (the default country), then the rest grouped roughly by region.
// `authSupported` is true everywhere; validity is enforced per-number downstream.
export const COUNTRIES: readonly Country[] = [
  { iso: "OM", callingCode: "+968", nameEn: "Oman", nameAr: "عُمان", authSupported: true },

  // GCC
  { iso: "SA", callingCode: "+966", nameEn: "Saudi Arabia", nameAr: "السعودية", authSupported: true },
  { iso: "AE", callingCode: "+971", nameEn: "United Arab Emirates", nameAr: "الإمارات العربية المتحدة", authSupported: true },
  { iso: "QA", callingCode: "+974", nameEn: "Qatar", nameAr: "قطر", authSupported: true },
  { iso: "KW", callingCode: "+965", nameEn: "Kuwait", nameAr: "الكويت", authSupported: true },
  { iso: "BH", callingCode: "+973", nameEn: "Bahrain", nameAr: "البحرين", authSupported: true },

  // Wider MENA
  { iso: "YE", callingCode: "+967", nameEn: "Yemen", nameAr: "اليمن", authSupported: true },
  { iso: "JO", callingCode: "+962", nameEn: "Jordan", nameAr: "الأردن", authSupported: true },
  { iso: "EG", callingCode: "+20", nameEn: "Egypt", nameAr: "مصر", authSupported: true },
  { iso: "LB", callingCode: "+961", nameEn: "Lebanon", nameAr: "لبنان", authSupported: true },
  { iso: "IQ", callingCode: "+964", nameEn: "Iraq", nameAr: "العراق", authSupported: true },
  { iso: "SY", callingCode: "+963", nameEn: "Syria", nameAr: "سوريا", authSupported: true },
  { iso: "PS", callingCode: "+970", nameEn: "Palestine", nameAr: "فلسطين", authSupported: true },
  { iso: "MA", callingCode: "+212", nameEn: "Morocco", nameAr: "المغرب", authSupported: true },
  { iso: "TN", callingCode: "+216", nameEn: "Tunisia", nameAr: "تونس", authSupported: true },
  { iso: "DZ", callingCode: "+213", nameEn: "Algeria", nameAr: "الجزائر", authSupported: true },
  { iso: "SD", callingCode: "+249", nameEn: "Sudan", nameAr: "السودان", authSupported: true },
  { iso: "LY", callingCode: "+218", nameEn: "Libya", nameAr: "ليبيا", authSupported: true },
  { iso: "TR", callingCode: "+90", nameEn: "Türkiye", nameAr: "تركيا", authSupported: true },
  { iso: "IR", callingCode: "+98", nameEn: "Iran", nameAr: "إيران", authSupported: true },

  // Europe (incl. BARQ UI locales)
  { iso: "GB", callingCode: "+44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة", authSupported: true },
  { iso: "DE", callingCode: "+49", nameEn: "Germany", nameAr: "ألمانيا", authSupported: true },
  { iso: "FR", callingCode: "+33", nameEn: "France", nameAr: "فرنسا", authSupported: true },
  { iso: "IT", callingCode: "+39", nameEn: "Italy", nameAr: "إيطاليا", authSupported: true },
  { iso: "ES", callingCode: "+34", nameEn: "Spain", nameAr: "إسبانيا", authSupported: true },
  { iso: "NL", callingCode: "+31", nameEn: "Netherlands", nameAr: "هولندا", authSupported: true },
  { iso: "CH", callingCode: "+41", nameEn: "Switzerland", nameAr: "سويسرا", authSupported: true },
  { iso: "SE", callingCode: "+46", nameEn: "Sweden", nameAr: "السويد", authSupported: true },
  { iso: "PL", callingCode: "+48", nameEn: "Poland", nameAr: "بولندا", authSupported: true },
  { iso: "CZ", callingCode: "+420", nameEn: "Czechia", nameAr: "التشيك", authSupported: true },
  { iso: "RU", callingCode: "+7", nameEn: "Russia", nameAr: "روسيا", authSupported: true },
  { iso: "GR", callingCode: "+30", nameEn: "Greece", nameAr: "اليونان", authSupported: true },
  { iso: "PT", callingCode: "+351", nameEn: "Portugal", nameAr: "البرتغال", authSupported: true },

  // Americas
  { iso: "US", callingCode: "+1", nameEn: "United States", nameAr: "الولايات المتحدة", authSupported: true },
  { iso: "CA", callingCode: "+1", nameEn: "Canada", nameAr: "كندا", authSupported: true },
  { iso: "BR", callingCode: "+55", nameEn: "Brazil", nameAr: "البرازيل", authSupported: true },

  // Asia-Pacific
  { iso: "IN", callingCode: "+91", nameEn: "India", nameAr: "الهند", authSupported: true },
  { iso: "PK", callingCode: "+92", nameEn: "Pakistan", nameAr: "باكستان", authSupported: true },
  { iso: "BD", callingCode: "+880", nameEn: "Bangladesh", nameAr: "بنغلاديش", authSupported: true },
  { iso: "LK", callingCode: "+94", nameEn: "Sri Lanka", nameAr: "سريلانكا", authSupported: true },
  { iso: "PH", callingCode: "+63", nameEn: "Philippines", nameAr: "الفلبين", authSupported: true },
  { iso: "ID", callingCode: "+62", nameEn: "Indonesia", nameAr: "إندونيسيا", authSupported: true },
  { iso: "MY", callingCode: "+60", nameEn: "Malaysia", nameAr: "ماليزيا", authSupported: true },
  { iso: "TH", callingCode: "+66", nameEn: "Thailand", nameAr: "تايلاند", authSupported: true },
  { iso: "SG", callingCode: "+65", nameEn: "Singapore", nameAr: "سنغافورة", authSupported: true },
  { iso: "CN", callingCode: "+86", nameEn: "China", nameAr: "الصين", authSupported: true },
  { iso: "JP", callingCode: "+81", nameEn: "Japan", nameAr: "اليابان", authSupported: true },
  { iso: "KR", callingCode: "+82", nameEn: "South Korea", nameAr: "كوريا الجنوبية", authSupported: true },
  { iso: "AU", callingCode: "+61", nameEn: "Australia", nameAr: "أستراليا", authSupported: true },

  // Africa (sub-Saharan)
  { iso: "ZA", callingCode: "+27", nameEn: "South Africa", nameAr: "جنوب إفريقيا", authSupported: true },
  { iso: "KE", callingCode: "+254", nameEn: "Kenya", nameAr: "كينيا", authSupported: true },
  { iso: "NG", callingCode: "+234", nameEn: "Nigeria", nameAr: "نيجيريا", authSupported: true },
] as const;

/** The default country for BARQ's phone entry (Oman — the default, not the only one). */
export const DEFAULT_COUNTRY: Country = COUNTRIES[0]!;

/** Look up a country by ISO alpha-2 (case-insensitive). */
export function findCountryByIso(iso: string): Country | undefined {
  const target = iso.trim().toUpperCase();
  return COUNTRIES.find((c) => c.iso === target);
}
