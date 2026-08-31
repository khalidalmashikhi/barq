import type { Locale } from "@/i18n/locales";
import { locales, defaultLocale } from "@/i18n/locales";

// BOOKING NOTIFICATION DELIVERY — the PURE, cron-safe renderer for a transactional booking email.
// Deliberately NOT next-intl (which is request-scoped): like the existing OTP template and the
// in-app notify.ts MESSAGES map, the strings live in a locale-keyed literal so the delivery worker
// can render outside any request, for any of the 8 BARQ locales, with a defaultLocale ("ar")
// fallback. No payment vocabulary anywhere (§15). All dynamic facts are HTML-escaped (§ injection).

export type BookingEmailKind =
  | "PENDING_PROVIDER"
  | "BOOKING_ACCEPTED"
  | "BOOKING_REJECTED"
  | "BOOKING_CANCELLED"
  | "BOOKING_CANCELLED_BY_CUSTOMER"
  | "BOOKING_EXPIRED";

const EMAIL_KINDS: readonly BookingEmailKind[] = [
  "PENDING_PROVIDER",
  "BOOKING_ACCEPTED",
  "BOOKING_REJECTED",
  "BOOKING_CANCELLED",
  "BOOKING_CANCELLED_BY_CUSTOMER",
  "BOOKING_EXPIRED",
];

/** Runtime narrow from an arbitrary stored kind string to a renderable email kind. */
export function isBookingEmailKind(kind: string): kind is BookingEmailKind {
  return (EMAIL_KINDS as readonly string[]).includes(kind);
}

/// Customer/provider-safe facts the caller has already resolved. NO private contact, NO ids beyond
/// the canonical booking URL, NO payment status.
export type BookingEmailFacts = {
  /// Localized service name (already resolved by the caller).
  serviceName: string;
  /// Canonical absolute BARQ link to the recipient's booking detail (built via buildPublicUrl).
  bookingUrl: string;
  /// Optional preformatted date/time of the slot (already localized), or null to omit the row.
  whenText?: string | null;
  /// Optional preformatted authoritative booking TOTAL (already localized), or null to omit. This
  /// is the booking total only — never framed as "paid"/"charged" (payment is NONE).
  totalText?: string | null;
};

type LocaleStrings = {
  subject: Record<BookingEmailKind, string>;
  message: Record<BookingEmailKind, string>;
  labelService: string;
  labelWhen: string;
  labelTotal: string;
  ctaCustomer: string;
  ctaProvider: string;
  footer: string;
};

// Per-kind audience for the CTA label (customer vs provider). Kept local to the renderer so the
// content module is self-contained; matches booking-email-policy's audience map.
const CTA_IS_PROVIDER: Record<BookingEmailKind, boolean> = {
  PENDING_PROVIDER: true,
  BOOKING_ACCEPTED: false,
  BOOKING_REJECTED: false,
  BOOKING_CANCELLED: false,
  BOOKING_CANCELLED_BY_CUSTOMER: true,
  BOOKING_EXPIRED: false,
};

const STRINGS: Record<Locale, LocaleStrings> = {
  en: {
    subject: {
      PENDING_PROVIDER: "New booking request",
      BOOKING_ACCEPTED: "Your booking is confirmed",
      BOOKING_REJECTED: "Your booking request was declined",
      BOOKING_CANCELLED: "Your booking was cancelled",
      BOOKING_CANCELLED_BY_CUSTOMER: "A booking was cancelled",
      BOOKING_EXPIRED: "Your booking request expired",
    },
    message: {
      PENDING_PROVIDER: "You have a new booking request awaiting your response.",
      BOOKING_ACCEPTED: "Your booking has been accepted by the provider.",
      BOOKING_REJECTED: "Your booking request was declined by the provider.",
      BOOKING_CANCELLED: "Your booking has been cancelled.",
      BOOKING_CANCELLED_BY_CUSTOMER: "A customer has cancelled one of your bookings.",
      BOOKING_EXPIRED: "This booking request expired because the scheduled time passed with no response.",
    },
    labelService: "Service",
    labelWhen: "When",
    labelTotal: "Total",
    ctaCustomer: "View your booking",
    ctaProvider: "View the request",
    footer: "You're receiving this because you have a booking on BARQ. Please don't reply to this email.",
  },
  ar: {
    subject: {
      PENDING_PROVIDER: "طلب حجز جديد",
      BOOKING_ACCEPTED: "تم تأكيد حجزك",
      BOOKING_REJECTED: "تم رفض طلب حجزك",
      BOOKING_CANCELLED: "تم إلغاء حجزك",
      BOOKING_CANCELLED_BY_CUSTOMER: "تم إلغاء أحد الحجوزات",
      BOOKING_EXPIRED: "انتهت صلاحية طلب حجزك",
    },
    message: {
      PENDING_PROVIDER: "لديك طلب حجز جديد بانتظار الرد.",
      BOOKING_ACCEPTED: "تم قبول حجزك من قبل مزود الخدمة.",
      BOOKING_REJECTED: "تم رفض حجزك من قبل مزود الخدمة.",
      BOOKING_CANCELLED: "تم إلغاء حجزك.",
      BOOKING_CANCELLED_BY_CUSTOMER: "قام أحد العملاء بإلغاء أحد حجوزاتك.",
      BOOKING_EXPIRED: "انتهت صلاحية طلب الحجز لأن الوقت المحدد قد مضى دون رد.",
    },
    labelService: "الخدمة",
    labelWhen: "الموعد",
    labelTotal: "الإجمالي",
    ctaCustomer: "عرض حجزك",
    ctaProvider: "عرض الطلب",
    footer: "تصلك هذه الرسالة لأن لديك حجزًا على برق. الرجاء عدم الرد على هذا البريد.",
  },
  de: {
    subject: {
      PENDING_PROVIDER: "Neue Buchungsanfrage",
      BOOKING_ACCEPTED: "Ihre Buchung ist bestätigt",
      BOOKING_REJECTED: "Ihre Buchungsanfrage wurde abgelehnt",
      BOOKING_CANCELLED: "Ihre Buchung wurde storniert",
      BOOKING_CANCELLED_BY_CUSTOMER: "Eine Buchung wurde storniert",
      BOOKING_EXPIRED: "Ihre Buchungsanfrage ist abgelaufen",
    },
    message: {
      PENDING_PROVIDER: "Sie haben eine neue Buchungsanfrage, die auf Ihre Antwort wartet.",
      BOOKING_ACCEPTED: "Ihre Buchung wurde vom Anbieter angenommen.",
      BOOKING_REJECTED: "Ihre Buchungsanfrage wurde vom Anbieter abgelehnt.",
      BOOKING_CANCELLED: "Ihre Buchung wurde storniert.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Ein Kunde hat eine Ihrer Buchungen storniert.",
      BOOKING_EXPIRED: "Diese Buchungsanfrage ist abgelaufen, weil der geplante Zeitpunkt ohne Antwort verstrichen ist.",
    },
    labelService: "Leistung",
    labelWhen: "Termin",
    labelTotal: "Gesamt",
    ctaCustomer: "Buchung ansehen",
    ctaProvider: "Anfrage ansehen",
    footer: "Sie erhalten diese E-Mail, weil Sie eine Buchung bei BARQ haben. Bitte antworten Sie nicht auf diese E-Mail.",
  },
  fr: {
    subject: {
      PENDING_PROVIDER: "Nouvelle demande de réservation",
      BOOKING_ACCEPTED: "Votre réservation est confirmée",
      BOOKING_REJECTED: "Votre demande de réservation a été refusée",
      BOOKING_CANCELLED: "Votre réservation a été annulée",
      BOOKING_CANCELLED_BY_CUSTOMER: "Une réservation a été annulée",
      BOOKING_EXPIRED: "Votre demande de réservation a expiré",
    },
    message: {
      PENDING_PROVIDER: "Vous avez une nouvelle demande de réservation en attente de réponse.",
      BOOKING_ACCEPTED: "Votre réservation a été acceptée par le prestataire.",
      BOOKING_REJECTED: "Votre demande de réservation a été refusée par le prestataire.",
      BOOKING_CANCELLED: "Votre réservation a été annulée.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Un client a annulé l'une de vos réservations.",
      BOOKING_EXPIRED: "Cette demande de réservation a expiré car l'heure prévue est passée sans réponse.",
    },
    labelService: "Service",
    labelWhen: "Quand",
    labelTotal: "Total",
    ctaCustomer: "Voir votre réservation",
    ctaProvider: "Voir la demande",
    footer: "Vous recevez cet e-mail car vous avez une réservation sur BARQ. Merci de ne pas répondre à cet e-mail.",
  },
  it: {
    subject: {
      PENDING_PROVIDER: "Nuova richiesta di prenotazione",
      BOOKING_ACCEPTED: "La tua prenotazione è confermata",
      BOOKING_REJECTED: "La tua richiesta di prenotazione è stata rifiutata",
      BOOKING_CANCELLED: "La tua prenotazione è stata annullata",
      BOOKING_CANCELLED_BY_CUSTOMER: "Una prenotazione è stata annullata",
      BOOKING_EXPIRED: "La tua richiesta di prenotazione è scaduta",
    },
    message: {
      PENDING_PROVIDER: "Hai una nuova richiesta di prenotazione in attesa di risposta.",
      BOOKING_ACCEPTED: "La tua prenotazione è stata accettata dal fornitore.",
      BOOKING_REJECTED: "La tua richiesta di prenotazione è stata rifiutata dal fornitore.",
      BOOKING_CANCELLED: "La tua prenotazione è stata annullata.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Un cliente ha annullato una delle tue prenotazioni.",
      BOOKING_EXPIRED: "Questa richiesta di prenotazione è scaduta perché l'orario previsto è passato senza risposta.",
    },
    labelService: "Servizio",
    labelWhen: "Quando",
    labelTotal: "Totale",
    ctaCustomer: "Vedi la tua prenotazione",
    ctaProvider: "Vedi la richiesta",
    footer: "Ricevi questa email perché hai una prenotazione su BARQ. Ti preghiamo di non rispondere a questa email.",
  },
  pl: {
    subject: {
      PENDING_PROVIDER: "Nowa prośba o rezerwację",
      BOOKING_ACCEPTED: "Twoja rezerwacja została potwierdzona",
      BOOKING_REJECTED: "Twoja prośba o rezerwację została odrzucona",
      BOOKING_CANCELLED: "Twoja rezerwacja została anulowana",
      BOOKING_CANCELLED_BY_CUSTOMER: "Rezerwacja została anulowana",
      BOOKING_EXPIRED: "Twoja prośba o rezerwację wygasła",
    },
    message: {
      PENDING_PROVIDER: "Masz nową prośbę o rezerwację oczekującą na odpowiedź.",
      BOOKING_ACCEPTED: "Twoja rezerwacja została zaakceptowana przez usługodawcę.",
      BOOKING_REJECTED: "Twoja prośba o rezerwację została odrzucona przez usługodawcę.",
      BOOKING_CANCELLED: "Twoja rezerwacja została anulowana.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Klient anulował jedną z Twoich rezerwacji.",
      BOOKING_EXPIRED: "Ta prośba o rezerwację wygasła, ponieważ zaplanowany czas minął bez odpowiedzi.",
    },
    labelService: "Usługa",
    labelWhen: "Kiedy",
    labelTotal: "Razem",
    ctaCustomer: "Zobacz swoją rezerwację",
    ctaProvider: "Zobacz prośbę",
    footer: "Otrzymujesz tę wiadomość, ponieważ masz rezerwację w BARQ. Prosimy nie odpowiadać na tę wiadomość.",
  },
  ru: {
    subject: {
      PENDING_PROVIDER: "Новый запрос на бронирование",
      BOOKING_ACCEPTED: "Ваше бронирование подтверждено",
      BOOKING_REJECTED: "Ваш запрос на бронирование отклонён",
      BOOKING_CANCELLED: "Ваше бронирование отменено",
      BOOKING_CANCELLED_BY_CUSTOMER: "Бронирование отменено",
      BOOKING_EXPIRED: "Срок вашего запроса на бронирование истёк",
    },
    message: {
      PENDING_PROVIDER: "У вас новый запрос на бронирование, ожидающий ответа.",
      BOOKING_ACCEPTED: "Ваше бронирование принято поставщиком услуги.",
      BOOKING_REJECTED: "Ваш запрос на бронирование отклонён поставщиком услуги.",
      BOOKING_CANCELLED: "Ваше бронирование отменено.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Клиент отменил одно из ваших бронирований.",
      BOOKING_EXPIRED: "Этот запрос на бронирование истёк, так как назначенное время прошло без ответа.",
    },
    labelService: "Услуга",
    labelWhen: "Когда",
    labelTotal: "Итого",
    ctaCustomer: "Посмотреть бронирование",
    ctaProvider: "Посмотреть запрос",
    footer: "Вы получили это письмо, потому что у вас есть бронирование в BARQ. Пожалуйста, не отвечайте на это письмо.",
  },
  cs: {
    subject: {
      PENDING_PROVIDER: "Nová žádost o rezervaci",
      BOOKING_ACCEPTED: "Vaše rezervace je potvrzena",
      BOOKING_REJECTED: "Vaše žádost o rezervaci byla zamítnuta",
      BOOKING_CANCELLED: "Vaše rezervace byla zrušena",
      BOOKING_CANCELLED_BY_CUSTOMER: "Rezervace byla zrušena",
      BOOKING_EXPIRED: "Platnost vaší žádosti o rezervaci vypršela",
    },
    message: {
      PENDING_PROVIDER: "Máte novou žádost o rezervaci čekající na odpověď.",
      BOOKING_ACCEPTED: "Vaše rezervace byla přijata poskytovatelem.",
      BOOKING_REJECTED: "Vaše žádost o rezervaci byla poskytovatelem zamítnuta.",
      BOOKING_CANCELLED: "Vaše rezervace byla zrušena.",
      BOOKING_CANCELLED_BY_CUSTOMER: "Zákazník zrušil jednu z vašich rezervací.",
      BOOKING_EXPIRED: "Tato žádost o rezervaci vypršela, protože naplánovaný čas uplynul bez odpovědi.",
    },
    labelService: "Služba",
    labelWhen: "Kdy",
    labelTotal: "Celkem",
    ctaCustomer: "Zobrazit rezervaci",
    ctaProvider: "Zobrazit žádost",
    footer: "Tento e-mail jste obdrželi, protože máte rezervaci na BARQ. Neodpovídejte prosím na tento e-mail.",
  },
};

// Compile-time guarantee that every one of the 8 BARQ locales has a full string set.
const _localeCoverage: Record<Locale, LocaleStrings> = STRINGS;
void _localeCoverage;

function resolveStrings(locale: string): { strings: LocaleStrings; locale: Locale } {
  const l = (locales as readonly string[]).includes(locale) ? (locale as Locale) : defaultLocale;
  return { strings: STRINGS[l], locale: l };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BuiltBookingEmail = { subject: string; html: string; text: string };

/**
 * Render a transactional booking email for a given kind + recipient locale + safe facts. Pure and
 * deterministic. Arabic renders RTL. The service name (provider-authored) and every dynamic value
 * are HTML-escaped. Contains no payment vocabulary and only a single canonical BARQ link.
 */
export function buildBookingEmail(params: {
  kind: BookingEmailKind;
  locale: string;
  facts: BookingEmailFacts;
}): BuiltBookingEmail {
  const { kind, facts } = params;
  const { strings, locale } = resolveStrings(params.locale);
  const isRtl = locale === "ar";
  const dir = isRtl ? "rtl" : "ltr";
  const align = isRtl ? "right" : "left";

  const subject = strings.subject[kind];
  const message = strings.message[kind];
  const cta = CTA_IS_PROVIDER[kind] ? strings.ctaProvider : strings.ctaCustomer;

  const rows: Array<{ label: string; value: string }> = [{ label: strings.labelService, value: facts.serviceName }];
  if (facts.whenText) rows.push({ label: strings.labelWhen, value: facts.whenText });
  if (facts.totalText) rows.push({ label: strings.labelTotal, value: facts.totalText });

  // ---- Plain text ----
  const textRows = rows.map((r) => `${r.label}: ${r.value}`).join("\n");
  const text = [message, "", textRows, "", `${cta}: ${facts.bookingUrl}`, "", strings.footer].join("\n");

  // ---- HTML (inline styles only; self-contained; dynamic values escaped) ----
  const htmlRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 0;color:#666;font-size:13px">${escapeHtml(r.label)}</td>` +
        `<td style="padding:4px 0;font-size:14px;font-weight:600;text-align:${align}">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");

  const html =
    `<div dir="${dir}" style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;text-align:${align};color:#111">` +
    `<div style="font-weight:700;font-size:18px;margin-bottom:16px">BARQ</div>` +
    `<p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(message)}</p>` +
    `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">${htmlRows}</table>` +
    `<a href="${encodeURI(facts.bookingUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9999px;font-size:14px;font-weight:600">${escapeHtml(cta)}</a>` +
    `<p style="font-size:12px;color:#999;line-height:1.5;margin:24px 0 0">${escapeHtml(strings.footer)}</p>` +
    `</div>`;

  return { subject, html, text };
}
