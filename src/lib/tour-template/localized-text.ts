// Smart Tour-Guide Template — the bilingual-plus type for admin-configurable
// default presentation strings. `ar` and `en` are required (the fail-closed
// fallback chain is requested -> en -> code default); the other BARQ locales are
// optional and, when present, are returned by resolveConfigText for that locale.
// This is presentation DATA only — it does not affect any package/vehicle
// semantics or domain logic.

export type LocalizedText = {
  ar: string;
  en: string;
  de?: string;
  it?: string;
  pl?: string;
  fr?: string;
  cs?: string;
  ru?: string;
};
