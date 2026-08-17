import "server-only";
import type { Locale } from "@/i18n/locales";
import { createInAppNotification, notifyActiveAdmins } from "./create-in-app-notification";

// Gate B2 — the central catalog + dispatchers for provider-lifecycle in-app
// notifications. This is the ONLY place that:
//   - defines the stable machine `eventType` strings (Phase 9 contract — never a
//     translated string, never a caller-supplied arbitrary value),
//   - carries each event's audience (PROVIDER vs ADMIN) so a provider event can
//     NEVER be fanned out to admins and an admin event can never be sent to a
//     provider (role-aware routing, enforced at dispatch),
//   - holds the bilingual/8-locale content (no PII, no free-text reason, no
//     filename, no document contents, no objectKey, no URL),
//   - maps each event to a `kind` for the EXISTING presentation layer (B3 rebuilds
//     rendering off eventType; until then legacy kinds keep their icons and new
//     events fall back to the generic icon).
// The actual CTA route (Review application → /admin/providers/[id]; Browse your
// workspace → /provider; etc.) is intentionally NOT stored — B3 resolves it from
// (eventType, entityType, entityId, recipient role).

export const PROVIDER_NOTIFICATION_EVENT = {
  VERIFICATION_SUBMITTED: "provider.verification_submitted",
  CHANGES_RESUBMITTED: "provider.changes_resubmitted",
  DOCUMENT_UPLOADED: "provider.document_uploaded",
  DOCUMENT_REPLACED: "provider.document_replaced",
  DOCUMENT_REJECTED: "provider.document_rejected",
  CHANGES_REQUESTED: "provider.changes_requested",
  APPROVED: "provider.approved",
  REJECTED: "provider.rejected",
  // Gate B4 — admin-governed activities.
  ACTIVITY_GRANTED: "provider.activity_granted",
  ACTIVITY_REVOKED: "provider.activity_revoked",
} as const;

export type ProviderNotificationEventType =
  (typeof PROVIDER_NOTIFICATION_EVENT)[keyof typeof PROVIDER_NOTIFICATION_EVENT];

type Audience = "PROVIDER" | "ADMIN";

type EventDef = {
  audience: Audience;
  /// content.kind for the existing presentation layer. The three legacy events
  /// reuse their established kinds so their icons are preserved.
  kind: string;
  messages: Record<Locale, string>;
};

const EVENT_DEFS: Record<ProviderNotificationEventType, EventDef> = {
  // -------- ADMIN events (fan out to every ACTIVE admin) --------
  "provider.verification_submitted": {
    audience: "ADMIN",
    kind: "PROVIDER_VERIFICATION_SUBMITTED",
    messages: {
      ar: "تم إرسال طلب مزود خدمة للمراجعة",
      en: "A provider application was submitted for review",
      de: "Ein Anbieter-Antrag wurde zur Prüfung eingereicht",
      it: "Una richiesta di fornitore è stata inviata per la revisione",
      pl: "Wniosek dostawcy został przesłany do weryfikacji",
      fr: "Une demande de prestataire a été soumise pour examen",
      cs: "Žádost poskytovatele byla odeslána ke kontrole",
      ru: "Заявка поставщика отправлена на рассмотрение",
    },
  },
  "provider.changes_resubmitted": {
    audience: "ADMIN",
    kind: "PROVIDER_CHANGES_RESUBMITTED",
    messages: {
      ar: "أعاد مزود الخدمة إرسال طلبه بعد إجراء التعديلات",
      en: "A provider re-submitted their application after making changes",
      de: "Ein Anbieter hat seinen Antrag nach Änderungen erneut eingereicht",
      it: "Un fornitore ha inviato di nuovo la richiesta dopo aver apportato modifiche",
      pl: "Dostawca ponownie przesłał wniosek po wprowadzeniu zmian",
      fr: "Un prestataire a soumis à nouveau sa demande après avoir effectué des modifications",
      cs: "Poskytovatel po provedení změn znovu odeslal žádost",
      ru: "Поставщик повторно отправил заявку после внесения изменений",
    },
  },
  "provider.document_uploaded": {
    audience: "ADMIN",
    kind: "PROVIDER_DOCUMENT_UPLOADED",
    messages: {
      ar: "تم رفع مستند تحقق لمزود خدمة",
      en: "A provider verification document was uploaded",
      de: "Ein Anbieter-Verifizierungsdokument wurde hochgeladen",
      it: "È stato caricato un documento di verifica del fornitore",
      pl: "Przesłano dokument weryfikacyjny dostawcy",
      fr: "Un document de vérification de prestataire a été téléversé",
      cs: "Byl nahrán ověřovací dokument poskytovatele",
      ru: "Загружен документ проверки поставщика",
    },
  },
  "provider.document_replaced": {
    audience: "ADMIN",
    kind: "PROVIDER_DOCUMENT_REPLACED",
    messages: {
      ar: "تم استبدال مستند تحقق لمزود خدمة",
      en: "A provider verification document was replaced",
      de: "Ein Anbieter-Verifizierungsdokument wurde ersetzt",
      it: "Un documento di verifica del fornitore è stato sostituito",
      pl: "Zastąpiono dokument weryfikacyjny dostawcy",
      fr: "Un document de vérification de prestataire a été remplacé",
      cs: "Ověřovací dokument poskytovatele byl nahrazen",
      ru: "Документ проверки поставщика заменён",
    },
  },
  // -------- PROVIDER events (to the owning provider's user only) --------
  "provider.approved": {
    audience: "PROVIDER",
    kind: "PROVIDER_APPROVED",
    messages: {
      ar: "تم اعتماد حساب مزود الخدمة",
      en: "Your provider account has been approved",
      de: "Ihr Anbieterkonto wurde genehmigt",
      it: "Il tuo account fornitore è stato approvato",
      pl: "Twoje konto dostawcy zostało zatwierdzone",
      fr: "Votre compte prestataire a été approuvé",
      cs: "Váš účet poskytovatele byl schválen",
      ru: "Ваш аккаунт поставщика одобрен",
    },
  },
  "provider.rejected": {
    audience: "PROVIDER",
    kind: "PROVIDER_REJECTED",
    // Static message only — the detailed rejection reason stays on the protected
    // /provider-application page, never in the notification body.
    messages: {
      ar: "تم رفض طلب مزود الخدمة",
      en: "Your provider application was rejected",
      de: "Ihr Anbieter-Antrag wurde abgelehnt",
      it: "La tua richiesta di fornitore è stata rifiutata",
      pl: "Twój wniosek dostawcy został odrzucony",
      fr: "Votre demande de prestataire a été rejetée",
      cs: "Vaše žádost poskytovatele byla zamítnuta",
      ru: "Ваша заявка поставщика отклонена",
    },
  },
  "provider.changes_requested": {
    audience: "PROVIDER",
    kind: "PROVIDER_CHANGES_REQUESTED",
    // Static — the requested-changes reason stays on /provider/verification.
    messages: {
      ar: "هناك تعديلات مطلوبة على طلب مزود الخدمة",
      en: "Changes are required for your provider application",
      de: "Für Ihren Anbieter-Antrag sind Änderungen erforderlich",
      it: "Sono richieste modifiche alla tua richiesta di fornitore",
      pl: "Wymagane są zmiany w Twoim wniosku dostawcy",
      fr: "Des modifications sont requises pour votre demande de prestataire",
      cs: "U vaší žádosti poskytovatele jsou vyžadovány změny",
      ru: "Требуются изменения в вашей заявке поставщика",
    },
  },
  "provider.document_rejected": {
    audience: "PROVIDER",
    kind: "PROVIDER_DOCUMENT_REJECTED",
    // Static — the per-document reason stays on /provider/verification.
    messages: {
      ar: "تم رفض أحد مستندات التحقق",
      en: "A verification document was rejected",
      de: "Ein Verifizierungsdokument wurde abgelehnt",
      it: "Un documento di verifica è stato rifiutato",
      pl: "Dokument weryfikacyjny został odrzucony",
      fr: "Un document de vérification a été rejeté",
      cs: "Ověřovací dokument byl zamítnut",
      ru: "Документ проверки отклонён",
    },
  },
  // Static, privacy-safe — no category id/name in the body (the provider sees the
  // activity in their workspace). Both route to the provider workspace (B3 CTA).
  "provider.activity_granted": {
    audience: "PROVIDER",
    kind: "PROVIDER_ACTIVITY_GRANTED",
    messages: {
      ar: "تمت إضافة نشاط جديد إلى حساب مزود الخدمة",
      en: "A new activity was added to your provider account",
      de: "Ihrem Anbieterkonto wurde eine neue Aktivität hinzugefügt",
      it: "Una nuova attività è stata aggiunta al tuo account fornitore",
      pl: "Do Twojego konta dostawcy dodano nową aktywność",
      fr: "Une nouvelle activité a été ajoutée à votre compte prestataire",
      cs: "K vašemu účtu poskytovatele byla přidána nová aktivita",
      ru: "В ваш аккаунт поставщика добавлена новая деятельность",
    },
  },
  "provider.activity_revoked": {
    audience: "PROVIDER",
    kind: "PROVIDER_ACTIVITY_REVOKED",
    messages: {
      ar: "تم تحديث الأنشطة المصرح بها في حساب مزود الخدمة",
      en: "The authorized activities on your provider account were updated",
      de: "Die autorisierten Aktivitäten Ihres Anbieterkontos wurden aktualisiert",
      it: "Le attività autorizzate del tuo account fornitore sono state aggiornate",
      pl: "Zaktualizowano autoryzowane aktywności na Twoim koncie dostawcy",
      fr: "Les activités autorisées de votre compte prestataire ont été mises à jour",
      cs: "Autorizované aktivity vašeho účtu poskytovatele byly aktualizovány",
      ru: "Разрешённые виды деятельности вашего аккаунта поставщика обновлены",
    },
  },
};

function buildContent(eventType: ProviderNotificationEventType) {
  const def = EVENT_DEFS[eventType];
  // Full 8-locale content (extractLocalizedText reads content[locale], ar→en
  // fallback) plus `kind` for the existing presentation layer.
  return { ...def.messages, kind: def.kind };
}

// Provider-facing dispatch — recipient is the owning provider's User id, resolved
// by the calling domain code (never client input). Throws if the event is not a
// PROVIDER event, so a mis-wired admin event can never reach a provider.
export async function notifyProviderOfEvent(
  eventType: ProviderNotificationEventType,
  target: { providerUserId: string; providerId: string }
): Promise<void> {
  const def = EVENT_DEFS[eventType];
  if (def.audience !== "PROVIDER") {
    throw new Error(`notifyProviderOfEvent called with a non-provider event: ${eventType}`);
  }
  await createInAppNotification({
    recipientUserId: target.providerUserId,
    eventType,
    entityType: "Provider",
    entityId: target.providerId,
    content: buildContent(eventType),
  });
}

// Admin-facing dispatch — fans out to every ACTIVE admin (recipients derived
// server-side in notifyActiveAdmins). Throws if the event is not an ADMIN event,
// so a provider event can never be broadcast to admins.
export async function notifyAdminsOfProviderEvent(
  eventType: ProviderNotificationEventType,
  target: { providerId: string }
): Promise<void> {
  const def = EVENT_DEFS[eventType];
  if (def.audience !== "ADMIN") {
    throw new Error(`notifyAdminsOfProviderEvent called with a non-admin event: ${eventType}`);
  }
  await notifyActiveAdmins({
    eventType,
    entityType: "Provider",
    entityId: target.providerId,
    content: buildContent(eventType),
  });
}
