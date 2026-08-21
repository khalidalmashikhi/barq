import "server-only";
import type { Locale } from "@/i18n/locales";
import { createInAppNotification } from "./create-in-app-notification";

// VEHICLE-LC4 — provider-facing structured notifications for meaningful vehicle
// verification events. Mirrors provider-notification-events.ts, but writes the
// notification with entityType "Vehicle" + entityId = assetId, so the CTA resolver
// can deep-link to the provider's own /provider/vehicles/[id] workspace (the
// Provider catalog hardcodes entityType "Provider" and cannot).
//
// PRIVACY: content is static 8-locale copy only — never the admin's free-text
// reason, objectKey, signed URL, registrationNumber, document contents, customer
// data, or admin ids. The per-decision reason lives in the private vehicle
// verification workspace, which the CTA links to.
//
// APPROVED != ACTIVE: the approval message deliberately says only that verification
// was approved — never "your vehicle is active/available to customers".
//
// AUDIENCE is PROVIDER only. These are presentation events; the authoritative audit
// trail is the LC3 AuditLog (not duplicated here).

export const VEHICLE_NOTIFICATION_EVENT = {
  CHANGES_REQUESTED: "vehicle.changes_requested",
  VERIFICATION_REJECTED: "vehicle.verification_rejected",
  VERIFICATION_APPROVED: "vehicle.verification_approved",
  DOCUMENT_REJECTED: "vehicle.document_rejected",
  // VEHICLE-LC7 — the vehicle was operationally ACTIVATED by an admin.
  ACTIVATED: "vehicle.activated",
} as const;

export type VehicleNotificationEventType = (typeof VEHICLE_NOTIFICATION_EVENT)[keyof typeof VEHICLE_NOTIFICATION_EVENT];

type EventDef = {
  /// content.kind for the existing notification presentation layer.
  kind: string;
  messages: Record<Locale, string>;
};

const EVENT_DEFS: Record<VehicleNotificationEventType, EventDef> = {
  "vehicle.changes_requested": {
    kind: "VEHICLE_CHANGES_REQUESTED",
    messages: {
      ar: "تم طلب تعديلات على مركبتك. راجع ملاحظات التحقق وأكمل التعديلات المطلوبة.",
      en: "Changes were requested for your vehicle. Review the verification notes and update the required information.",
      de: "Für Ihr Fahrzeug wurden Änderungen angefordert. Prüfen Sie die Verifizierungshinweise und aktualisieren Sie die erforderlichen Angaben.",
      it: "Sono state richieste modifiche al tuo veicolo. Controlla le note di verifica e aggiorna le informazioni richieste.",
      pl: "Zażądano zmian dla Twojego pojazdu. Przejrzyj uwagi weryfikacyjne i zaktualizuj wymagane informacje.",
      fr: "Des modifications ont été demandées pour votre véhicule. Consultez les notes de vérification et mettez à jour les informations requises.",
      cs: "U vašeho vozidla byly vyžádány změny. Zkontrolujte poznámky k ověření a aktualizujte požadované informace.",
      ru: "По вашему транспорту запрошены изменения. Просмотрите примечания проверки и обновите необходимую информацию.",
    },
  },
  "vehicle.verification_rejected": {
    kind: "VEHICLE_VERIFICATION_REJECTED",
    messages: {
      ar: "لم تتم الموافقة على تحقق مركبتك. افتح تفاصيل تحقق المركبة لمزيد من المعلومات.",
      en: "Your vehicle verification was not approved. Open the vehicle verification details for more information.",
      de: "Die Verifizierung Ihres Fahrzeugs wurde nicht genehmigt. Öffnen Sie die Verifizierungsdetails des Fahrzeugs für weitere Informationen.",
      it: "La verifica del tuo veicolo non è stata approvata. Apri i dettagli di verifica del veicolo per maggiori informazioni.",
      pl: "Weryfikacja Twojego pojazdu nie została zatwierdzona. Otwórz szczegóły weryfikacji pojazdu, aby uzyskać więcej informacji.",
      fr: "La vérification de votre véhicule n'a pas été approuvée. Ouvrez les détails de vérification du véhicule pour plus d'informations.",
      cs: "Ověření vašeho vozidla nebylo schváleno. Otevřete podrobnosti ověření vozidla pro více informací.",
      ru: "Проверка вашего транспорта не одобрена. Откройте детали проверки транспорта для получения дополнительной информации.",
    },
  },
  "vehicle.verification_approved": {
    kind: "VEHICLE_VERIFICATION_APPROVED",
    // Deliberately does NOT say "active" / "available to customers" — approval is
    // the verification axis only; operational activation is separate.
    messages: {
      ar: "تمت الموافقة على تحقق مركبتك.",
      en: "Your vehicle verification has been approved.",
      de: "Die Verifizierung Ihres Fahrzeugs wurde genehmigt.",
      it: "La verifica del tuo veicolo è stata approvata.",
      pl: "Weryfikacja Twojego pojazdu została zatwierdzona.",
      fr: "La vérification de votre véhicule a été approuvée.",
      cs: "Ověření vašeho vozidla bylo schváleno.",
      ru: "Проверка вашего транспорта одобрена.",
    },
  },
  "vehicle.activated": {
    kind: "VEHICLE_ACTIVATED",
    // Operational activation only. Deliberately does NOT promise booking availability
    // (customer-side consumption is out of scope) — just that the vehicle is now active.
    messages: {
      ar: "تم تفعيل مركبتك في برق.",
      en: "Your vehicle has been activated in BARQ.",
      de: "Ihr Fahrzeug wurde in BARQ aktiviert.",
      it: "Il tuo veicolo è stato attivato in BARQ.",
      pl: "Twój pojazd został aktywowany w BARQ.",
      fr: "Votre véhicule a été activé dans BARQ.",
      cs: "Vaše vozidlo bylo aktivováno v BARQ.",
      ru: "Ваш транспорт активирован в BARQ.",
    },
  },
  "vehicle.document_rejected": {
    kind: "VEHICLE_DOCUMENT_REJECTED",
    // Static — the per-document reason stays in the private vehicle workspace.
    messages: {
      ar: "أحد مستندات المركبة المطلوبة يحتاج إلى مراجعة.",
      en: "A required vehicle document needs attention.",
      de: "Ein erforderliches Fahrzeugdokument erfordert Ihre Aufmerksamkeit.",
      it: "Un documento del veicolo richiesto necessita attenzione.",
      pl: "Wymagany dokument pojazdu wymaga uwagi.",
      fr: "Un document de véhicule requis nécessite votre attention.",
      cs: "Požadovaný dokument vozidla vyžaduje pozornost.",
      ru: "Требуемый документ транспорта нуждается во внимании.",
    },
  },
};

function buildContent(eventType: VehicleNotificationEventType) {
  const def = EVENT_DEFS[eventType];
  return { ...def.messages, kind: def.kind };
}

/**
 * Notify the OWNING provider of a vehicle verification event. Recipient is the
 * provider's User id (server-derived by the calling LC3 domain action via
 * Asset -> Provider -> userId — never client/admin input). The notification is
 * keyed to entityType "Vehicle" + the assetId so the CTA resolves to the provider's
 * own vehicle workspace.
 */
export async function notifyProviderOfVehicleEvent(
  eventType: VehicleNotificationEventType,
  target: { providerUserId: string; assetId: string },
): Promise<void> {
  await createInAppNotification({
    recipientUserId: target.providerUserId,
    eventType,
    entityType: "Vehicle",
    entityId: target.assetId,
    content: buildContent(eventType),
  });
}
