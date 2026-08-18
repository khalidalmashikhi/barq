// Smart Tour-Guide Template — canonical PACKAGE registry (app-owned).
//
// Pure: no server-only / prisma / next imports, so it runs under vitest and in
// client bundles alike, and is the single source of truth shared by the Zod
// guidingContent contract, the config readers, and the bootstrap seed.
//
// AUTHORITY SPLIT: the KEYS and their BEHAVIOURAL SEMANTICS below are owned by
// application code and are NEVER stored in the DB or editable by an admin. Admin
// may only edit the localized label/description/enabled/sortOrder of a preset
// (see TourPackagePreset). This is what guarantees admin configuration can never
// disable a server invariant (e.g. GUIDE_WITH_4X4 always requires a 4x4 vehicle).

import type { LocalizedText } from "./localized-text";

export const TOUR_PACKAGE_KEYS = [
  "GUIDE_ONLY",
  "GUIDE_WITH_TRANSPORT",
  "GUIDE_WITH_4X4",
  "PRIVATE_CUSTOM_TOUR",
] as const;

export type TourPackageKey = (typeof TOUR_PACKAGE_KEYS)[number];

const PACKAGE_KEY_SET: ReadonlySet<string> = new Set(TOUR_PACKAGE_KEYS);

export function isTourPackageKey(value: unknown): value is TourPackageKey {
  return typeof value === "string" && PACKAGE_KEY_SET.has(value);
}

// Behavioural semantics DERIVED FROM KEY — the security-relevant half, never
// persisted, never admin-editable. The guidingContent contract reads THIS to
// decide the vehicle rules; a DB TourTemplateFieldRule can never override it.
//   - includesTransport → a vehicle block is REQUIRED
//   - requiresFourByFour → the vehicle.type MUST be FOUR_BY_FOUR
//   - vehicleOptional → a vehicle block MAY be present or absent (never forced,
//     never forbidden). Exactly one of {includesTransport, vehicleOptional} being
//     false-and-false means "vehicle must be ABSENT" (GUIDE_ONLY).
export type TourPackageSemantics = {
  includesTransport: boolean;
  requiresFourByFour: boolean;
  vehicleOptional: boolean;
};

export const TOUR_PACKAGE_SEMANTICS: Record<TourPackageKey, TourPackageSemantics> = {
  // vehicle must be ABSENT
  GUIDE_ONLY: { includesTransport: false, requiresFourByFour: false, vehicleOptional: false },
  // vehicle REQUIRED
  GUIDE_WITH_TRANSPORT: { includesTransport: true, requiresFourByFour: false, vehicleOptional: false },
  // vehicle REQUIRED and type === FOUR_BY_FOUR
  GUIDE_WITH_4X4: { includesTransport: true, requiresFourByFour: true, vehicleOptional: false },
  // vehicle OPTIONAL — the only key with no forced vehicle rule; deliberately NOT
  // a validation bypass (every other field's rules still apply).
  PRIVATE_CUSTOM_TOUR: { includesTransport: false, requiresFourByFour: false, vehicleOptional: true },
};

// Default bilingual presentation — the bootstrap seed AND the fail-closed
// fallback when a preset row is absent. { ar, en }; other locales fall back to
// en, then to these built-ins (see resolveConfigText).
export type TourPackageDefault = {
  key: TourPackageKey;
  label: LocalizedText;
  description: LocalizedText;
  sortOrder: number;
};

export const TOUR_PACKAGE_DEFAULTS: readonly TourPackageDefault[] = [
  {
    key: "GUIDE_ONLY",
    sortOrder: 0,
    label: {
      ar: "جولة مع مرشد سياحي",
      en: "Guided tour with a tour guide",
      de: "Geführte Tour mit Reiseführer",
      it: "Tour guidato con guida turistica",
      pl: "Wycieczka z przewodnikiem",
      fr: "Circuit guidé avec un guide touristique",
      cs: "Prohlídka s turistickým průvodcem",
      ru: "Тур с гидом",
    },
    description: {
      ar: "جولة برفقة مرشد سياحي محلي دون خدمة توصيل.",
      en: "A tour with a local guide, without transportation.",
      de: "Eine Tour mit einem lokalen Reiseführer, ohne Transport.",
      it: "Un tour con una guida locale, senza trasporto.",
      pl: "Wycieczka z lokalnym przewodnikiem, bez transportu.",
      fr: "Un circuit avec un guide local, sans transport.",
      cs: "Prohlídka s místním průvodcem, bez dopravy.",
      ru: "Тур с местным гидом, без транспорта.",
    },
  },
  {
    key: "GUIDE_WITH_TRANSPORT",
    sortOrder: 1,
    label: {
      ar: "جولة مع مرشد سياحي شاملة التوصيل",
      en: "Guided tour with transportation",
      de: "Geführte Tour inklusive Transport",
      it: "Tour guidato con trasporto",
      pl: "Wycieczka z przewodnikiem i transportem",
      fr: "Circuit guidé avec transport",
      cs: "Prohlídka s průvodcem včetně dopravy",
      ru: "Тур с гидом и транспортом",
    },
    description: {
      ar: "جولة مع مرشد محلي تشمل خدمة التوصيل بمركبة.",
      en: "A guided tour that includes transportation by vehicle.",
      de: "Eine geführte Tour inklusive Transport per Fahrzeug.",
      it: "Un tour guidato che include il trasporto in veicolo.",
      pl: "Wycieczka z przewodnikiem obejmująca transport pojazdem.",
      fr: "Un circuit guidé incluant le transport en véhicule.",
      cs: "Prohlídka s průvodcem včetně dopravy vozidlem.",
      ru: "Тур с гидом, включающий транспорт.",
    },
  },
  {
    key: "GUIDE_WITH_4X4",
    sortOrder: 2,
    label: {
      ar: "جولة مع مرشد ومركبة دفع رباعي",
      en: "Guided tour with a 4x4 vehicle",
      de: "Geführte Tour mit Allradfahrzeug (4x4)",
      it: "Tour guidato con veicolo 4x4",
      pl: "Wycieczka z przewodnikiem pojazdem 4x4",
      fr: "Circuit guidé avec un véhicule 4x4",
      cs: "Prohlídka s průvodcem vozidlem 4x4",
      ru: "Тур с гидом на внедорожнике 4x4",
    },
    description: {
      ar: "جولة مع مرشد محلي بمركبة دفع رباعي للمسارات الجبلية والصحراوية.",
      en: "A guided tour with a 4x4 vehicle for mountain and desert routes.",
      de: "Eine geführte Tour mit Allradfahrzeug für Berg- und Wüstenrouten.",
      it: "Un tour guidato con veicolo 4x4 per percorsi montani e desertici.",
      pl: "Wycieczka z przewodnikiem pojazdem 4x4 na trasy górskie i pustynne.",
      fr: "Un circuit guidé en 4x4 pour les itinéraires en montagne et dans le désert.",
      cs: "Prohlídka s průvodcem vozidlem 4x4 pro horské a pouštní trasy.",
      ru: "Тур с гидом на внедорожнике 4x4 по горным и пустынным маршрутам.",
    },
  },
  {
    key: "PRIVATE_CUSTOM_TOUR",
    sortOrder: 3,
    label: {
      ar: "جولة خاصة مخصصة",
      en: "Private custom tour",
      de: "Private individuelle Tour",
      it: "Tour privato personalizzato",
      pl: "Prywatna wycieczka na zamówienie",
      fr: "Circuit privé sur mesure",
      cs: "Soukromá prohlídka na míru",
      ru: "Частный индивидуальный тур",
    },
    description: {
      ar: "جولة خاصة تُصمَّم حسب طلب الضيف؛ تُحدَّد التفاصيل مع المرشد.",
      en: "A private tour tailored to the guest; details are arranged with the guide.",
      de: "Eine private Tour nach den Wünschen des Gastes; Details werden mit dem Guide abgestimmt.",
      it: "Un tour privato su misura per l'ospite; i dettagli si concordano con la guida.",
      pl: "Prywatna wycieczka dostosowana do gościa; szczegóły ustalane są z przewodnikiem.",
      fr: "Un circuit privé adapté au client ; les détails sont convenus avec le guide.",
      cs: "Soukromá prohlídka přizpůsobená hostovi; podrobnosti se domlouvají s průvodcem.",
      ru: "Частный тур по пожеланиям гостя; детали согласуются с гидом.",
    },
  },
];
