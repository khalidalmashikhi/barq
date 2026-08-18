// Smart Tour-Guide Template — app-owned TEMPLATE-TEXT registry.
//
// Pure. Admin may edit the localized content of these blocks (see
// TourTemplateText), but the KEY set is app-owned: a reader only ever resolves a
// key defined here, and falls back requested-locale → en → the built-in default
// below. An unknown DB key is ignored, never rendered.

import type { LocalizedText } from "./localized-text";

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
  content: LocalizedText;
  sortOrder: number;
};

export const TOUR_TEMPLATE_TEXT_DEFAULTS: readonly TourTemplateTextDefault[] = [
  {
    key: "template.intro",
    sortOrder: 0,
    content: {
      ar: "استكشف الوجهة برفقة مرشد محلي، مع إمكانية إضافة خدمة التوصيل حسب الباقة المختارة. يتم تحديد المسار والتفاصيل وفق الجولة والحجز.",
      en: "Explore the destination with a local guide, with optional transportation depending on the selected package. Route and trip details depend on the tour and booking.",
      de: "Erkunde das Reiseziel mit einem lokalen Guide – mit optionalem Transport je nach gewähltem Paket. Route und Details richten sich nach Tour und Buchung.",
      it: "Esplora la destinazione con una guida locale, con trasporto opzionale a seconda del pacchetto scelto. Percorso e dettagli dipendono dal tour e dalla prenotazione.",
      pl: "Poznaj cel podróży z lokalnym przewodnikiem, z opcjonalnym transportem zależnie od wybranego pakietu. Trasa i szczegóły zależą od wycieczki i rezerwacji.",
      fr: "Explorez la destination avec un guide local, avec transport en option selon le forfait choisi. L'itinéraire et les détails dépendent du circuit et de la réservation.",
      cs: "Prozkoumejte destinaci s místním průvodcem, s volitelnou dopravou podle zvoleného balíčku. Trasa a podrobnosti závisí na prohlídce a rezervaci.",
      ru: "Исследуйте направление с местным гидом; транспорт по желанию в зависимости от выбранного пакета. Маршрут и детали зависят от тура и бронирования.",
    },
  },
  {
    key: "template.heading",
    sortOrder: 1,
    content: {
      ar: "جولة مع مرشد سياحي",
      en: "Guided Tour",
      de: "Geführte Tour",
      it: "Tour guidato",
      pl: "Wycieczka z przewodnikiem",
      fr: "Circuit guidé",
      cs: "Prohlídka s průvodcem",
      ru: "Тур с гидом",
    },
  },
  {
    key: "importantNotes.default",
    sortOrder: 2,
    content: {
      ar: "يرجى الحضور قبل موعد البدء بعشر دقائق. قد تتأثر بعض الجولات بالأحوال الجوية.",
      en: "Please arrive 10 minutes before the start time. Some tours may be affected by weather conditions.",
      de: "Bitte finde dich 10 Minuten vor Beginn ein. Einige Touren können von den Wetterbedingungen beeinflusst werden.",
      it: "Arriva 10 minuti prima dell'orario di inizio. Alcuni tour possono essere influenzati dalle condizioni meteo.",
      pl: "Prosimy przyjść 10 minut przed rozpoczęciem. Niektóre wycieczki mogą zależeć od warunków pogodowych.",
      fr: "Merci d'arriver 10 minutes avant le départ. Certains circuits peuvent être affectés par les conditions météo.",
      cs: "Dostavte se prosím 10 minut před začátkem. Některé prohlídky mohou být ovlivněny počasím.",
      ru: "Пожалуйста, приходите за 10 минут до начала. Некоторые туры зависят от погодных условий.",
    },
  },
];
