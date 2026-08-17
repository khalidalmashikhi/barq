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
  label: { ar: string; en: string };
  description: { ar: string; en: string };
  sortOrder: number;
};

export const TOUR_PACKAGE_DEFAULTS: readonly TourPackageDefault[] = [
  {
    key: "GUIDE_ONLY",
    sortOrder: 0,
    label: { ar: "جولة مع مرشد سياحي", en: "Guided tour with a tour guide" },
    description: {
      ar: "جولة برفقة مرشد سياحي محلي دون خدمة توصيل.",
      en: "A tour with a local guide, without transportation.",
    },
  },
  {
    key: "GUIDE_WITH_TRANSPORT",
    sortOrder: 1,
    label: { ar: "جولة مع مرشد سياحي شاملة التوصيل", en: "Guided tour with transportation" },
    description: {
      ar: "جولة مع مرشد محلي تشمل خدمة التوصيل بمركبة.",
      en: "A guided tour that includes transportation by vehicle.",
    },
  },
  {
    key: "GUIDE_WITH_4X4",
    sortOrder: 2,
    label: { ar: "جولة مع مرشد ومركبة دفع رباعي", en: "Guided tour with a 4x4 vehicle" },
    description: {
      ar: "جولة مع مرشد محلي بمركبة دفع رباعي للمسارات الجبلية والصحراوية.",
      en: "A guided tour with a 4x4 vehicle for mountain and desert routes.",
    },
  },
  {
    key: "PRIVATE_CUSTOM_TOUR",
    sortOrder: 3,
    label: { ar: "جولة خاصة مخصصة", en: "Private custom tour" },
    description: {
      ar: "جولة خاصة تُصمَّم حسب طلب الضيف؛ تُحدَّد التفاصيل مع المرشد.",
      en: "A private tour tailored to the guest; details are arranged with the guide.",
    },
  },
];
