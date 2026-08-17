// Smart Tour-Guide Template — app-owned TEMPLATE-TEXT registry.
//
// Pure. Admin may edit the localized content of these blocks (see
// TourTemplateText), but the KEY set is app-owned: a reader only ever resolves a
// key defined here, and falls back requested-locale → en → the built-in default
// below. An unknown DB key is ignored, never rendered.

export const TOUR_TEMPLATE_TEXT_KEYS = [
  "template.intro",
  "template.heading",
  "importantNotes.default",
] as const;

export type TourTemplateTextKey = (typeof TOUR_TEMPLATE_TEXT_KEYS)[number];

const TEXT_KEY_SET: ReadonlySet<string> = new Set(TOUR_TEMPLATE_TEXT_KEYS);

export function isTourTemplateTextKey(value: unknown): value is TourTemplateTextKey {
  return typeof value === "string" && TEXT_KEY_SET.has(value);
}

export type TourTemplateTextDefault = {
  key: TourTemplateTextKey;
  content: { ar: string; en: string };
  sortOrder: number;
};

export const TOUR_TEMPLATE_TEXT_DEFAULTS: readonly TourTemplateTextDefault[] = [
  {
    key: "template.intro",
    sortOrder: 0,
    content: {
      ar: "استكشف الوجهة برفقة مرشد محلي، مع إمكانية إضافة خدمة التوصيل حسب الباقة المختارة. يتم تحديد المسار والتفاصيل وفق الجولة والحجز.",
      en: "Explore the destination with a local guide, with optional transportation depending on the selected package. Route and trip details depend on the tour and booking.",
    },
  },
  {
    key: "template.heading",
    sortOrder: 1,
    content: { ar: "جولة مع مرشد سياحي", en: "Guided Tour" },
  },
  {
    key: "importantNotes.default",
    sortOrder: 2,
    content: {
      ar: "يرجى الحضور قبل موعد البدء بعشر دقائق. قد تتأثر بعض الجولات بالأحوال الجوية.",
      en: "Please arrive 10 minutes before the start time. Some tours may be affected by weather conditions.",
    },
  },
];
