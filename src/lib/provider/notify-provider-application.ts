import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";

// Provider application notifications — Customer → Provider Journey (C).
//
// Reuses the EXISTING notification architecture exactly, with no schema or
// migration change: it writes one Notification row whose bilingual/multilingual
// `content` Json carries the rendered per-locale strings plus an inline `kind`
// (the same shape src/lib/booking/lifecycle/notify.ts and
// src/lib/contracts/execution/notify.ts already established). There is no
// dedicated "kind"/"type" column, so `kind` lives inside `content`.
//
// CHANNEL CONVENTION, NOT REAL EMAIL: NotificationChannel currently has no
// IN_APP value (only WHATSAPP/EMAIL/SMS), yet the in-app Notification Center
// reads these same rows via `readAt`. So — exactly like the two existing
// writers — this uses `channel: "EMAIL"` purely as the schema-required
// compatibility value. NO external email/SMS is dispatched: no delivery
// pipeline exists in this codebase (see notify.ts's own comment). Treat this
// row as the in-app Notification Center record and nothing more.
//
// UNLIKE the booking writer, there is no causingBookingId here (approval is
// not tied to a booking); that column is nullable and simply omitted.
//
// FULL 8-LOCALE CONTENT, DELIBERATELY: extractLocalizedText() (verified) reads
// content[locale] for any of the 8 BARQ locales before falling back ar → en,
// so storing all 8 lets this notification render natively in every locale,
// rather than inheriting the ar/en-only limitation older rows carry.

export type ProviderApplicationNotificationKind = "PROVIDER_APPROVED" | "PROVIDER_REJECTED" | "PROVIDER_DOCUMENT_REJECTED";

// PROVIDER_REJECTED is a STATIC localized message only — it deliberately does
// NOT embed the admin's free-text rejection reason (that is single-language and
// unlocalizable). It directs the applicant to their application page, where the
// current reason (Provider.rejectionReason) is displayed and Resubmit lives.
const MESSAGES: Record<ProviderApplicationNotificationKind, Record<Locale, string>> = {
  PROVIDER_APPROVED: {
    ar: "تمت الموافقة على طلب انضمامك كمزوّد. يمكنك الآن فتح مساحة عمل المزوّد الخاصة بك.",
    en: "Your provider application has been approved. You can now open your provider workspace.",
    de: "Ihr Anbieter-Antrag wurde genehmigt. Sie können jetzt Ihren Anbieterbereich öffnen.",
    it: "La tua richiesta come fornitore è stata approvata. Ora puoi aprire il tuo spazio fornitore.",
    pl: "Twój wniosek o zostanie dostawcą został zatwierdzony. Możesz teraz otworzyć panel dostawcy.",
    fr: "Votre demande de prestataire a été approuvée. Vous pouvez maintenant ouvrir votre espace prestataire.",
    cs: "Vaše žádost o poskytovatele byla schválena. Nyní si můžete otevřít svůj prostor poskytovatele.",
    ru: "Ваша заявка на статус поставщика одобрена. Теперь вы можете открыть свой кабинет поставщика.",
  },
  PROVIDER_REJECTED: {
    ar: "لم تتم الموافقة على طلب انضمامك كمزوّد. افتح طلبك لمعرفة السبب وإعادة التقديم.",
    en: "Your provider application was not approved. Open your application to see the reason and resubmit.",
    de: "Ihr Anbieter-Antrag wurde nicht genehmigt. Öffnen Sie Ihren Antrag, um den Grund zu sehen und ihn erneut einzureichen.",
    it: "La tua richiesta come fornitore non è stata approvata. Apri la tua richiesta per vedere il motivo e inviarla di nuovo.",
    pl: "Twój wniosek o zostanie dostawcą nie został zatwierdzony. Otwórz wniosek, aby zobaczyć powód i złożyć go ponownie.",
    fr: "Votre demande de prestataire n'a pas été approuvée. Ouvrez votre demande pour voir le motif et la soumettre à nouveau.",
    cs: "Vaše žádost o poskytovatele nebyla schválena. Otevřete žádost, kde uvidíte důvod a můžete ji znovu odeslat.",
    ru: "Ваша заявка на статус поставщика не одобрена. Откройте заявку, чтобы увидеть причину и подать её повторно.",
  },
  // Document-level rejection (Gate 3) — static, no embedded free-text reason;
  // the actual reason is shown on /provider/verification. This does NOT reject
  // the whole provider application.
  PROVIDER_DOCUMENT_REJECTED: {
    ar: "لم تتم الموافقة على أحد مستندات التحقق الخاصة بك. افتح صفحة التحقق لمعرفة السبب واستبدال المستند.",
    en: "One of your verification documents was not approved. Open your verification page to see why and replace it.",
    de: "Eines Ihrer Verifizierungsdokumente wurde nicht genehmigt. Öffnen Sie Ihre Verifizierungsseite, um den Grund zu sehen und es zu ersetzen.",
    it: "Uno dei tuoi documenti di verifica non è stato approvato. Apri la pagina di verifica per vedere il motivo e sostituirlo.",
    pl: "Jeden z Twoich dokumentów weryfikacyjnych nie został zatwierdzony. Otwórz stronę weryfikacji, aby zobaczyć powód i go zastąpić.",
    fr: "L'un de vos documents de vérification n'a pas été approuvé. Ouvrez votre page de vérification pour voir le motif et le remplacer.",
    cs: "Jeden z vašich ověřovacích dokumentů nebyl schválen. Otevřete stránku ověření, kde uvidíte důvod a můžete jej nahradit.",
    ru: "Один из ваших документов для проверки не одобрен. Откройте страницу проверки, чтобы узнать причину и заменить его.",
  },
};

export interface NotifyProviderApplicationEventParams {
  /// The recipient's User id (Notification.userId), NOT the Provider id —
  /// Provider.userId is the join the caller must resolve.
  userId: string;
  kind: ProviderApplicationNotificationKind;
}

export async function notifyProviderApplicationEvent(params: NotifyProviderApplicationEventParams): Promise<void> {
  const { userId, kind } = params;

  await prisma.notification.create({
    data: {
      userId,
      content: { ...MESSAGES[kind], kind },
      channel: "EMAIL",
    },
  });
}
