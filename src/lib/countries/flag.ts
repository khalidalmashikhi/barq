// Derive a flag emoji from an ISO 3166-1 alpha-2 code using Unicode regional
// indicator symbols — so no flag image/asset is stored per country (registry.ts
// keeps only the `iso`). Pure/isomorphic. Falls back to a neutral white flag for
// a malformed code rather than throwing.

const REGIONAL_INDICATOR_A = 0x1f1e6; // 🇦
const LETTER_A = 65; // 'A'

export function isoToFlagEmoji(iso: string): string {
  const code = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "\u{1F3F3}\u{FE0F}"; // 🏳️
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (code.charCodeAt(0) - LETTER_A),
    REGIONAL_INDICATOR_A + (code.charCodeAt(1) - LETTER_A)
  );
}
