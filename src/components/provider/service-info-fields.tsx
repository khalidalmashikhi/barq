import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { ServiceInfoRaw } from "@/lib/services/service-info";

// Service Information Model — the provider authoring fields for the booking-decision data,
// shared by the create and edit service forms (one field group, not a second management
// system). Every field is OPTIONAL; the whole block is a single collapsible-free "Service
// details (optional)" section. Input `name`s match the server parser (service-info.ts).
//
// `defaults` prefills the edit form with the service's current values (bilingual). Text areas
// hold one list item per line. No client-authoritative validation — the server is the
// authority; the numeric inputs carry min attributes for convenience only.

const inputClass =
  "rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

type Props = { defaults?: ServiceInfoRaw };

export async function ServiceInfoFields({ defaults }: Props) {
  const t = await getServerTranslator("provider");
  const lines = (l?: string[]) => (l && l.length ? l.join("\n") : "");
  const si = defaults?.startInstructions;

  return (
    <fieldset className="flex flex-col gap-4 rounded-2xl border border-border bg-background/40 p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">{t("sectionServiceDetailsTitle")}</legend>

      {/* Duration + per-booking seat bounds */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground/70">{t("durationMinutesLabel")}</span>
          <input type="number" inputMode="numeric" min={1} name="durationMinutes" defaultValue={defaults?.durationMinutes ?? ""} className={inputClass} />
          <span className="text-xs text-foreground/50">{t("durationHint")}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground/70">{t("minSeatsLabel")}</span>
          <input type="number" inputMode="numeric" min={1} name="minBookingSeats" defaultValue={defaults?.minBookingSeats ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground/70">{t("maxSeatsLabel")}</span>
          <input type="number" inputMode="numeric" min={1} name="maxBookingSeats" defaultValue={defaults?.maxBookingSeats ?? ""} className={inputClass} />
        </label>
      </div>
      <span className="-mt-2 text-xs text-foreground/50">{t("seatsHint")}</span>

      {/* Start instructions (bilingual free text) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/70">{t("startInstructionsLabel")}</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <textarea name="startInstructionsAr" rows={2} dir="rtl" aria-label={t("arabicSublabel")} placeholder={t("arabicSublabel")} defaultValue={si?.ar ?? ""} className={inputClass} />
          <textarea name="startInstructionsEn" rows={2} dir="ltr" aria-label={t("englishSublabel")} placeholder={t("englishSublabel")} defaultValue={si?.en ?? ""} className={inputClass} />
        </div>
        <span className="text-xs text-foreground/50">{t("startInstructionsHint")}</span>
      </div>

      {/* Inclusions (bilingual, one item per line) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/70">{t("inclusionsLabel")}</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <textarea name="inclusionsAr" rows={3} dir="rtl" aria-label={t("arabicSublabel")} placeholder={t("arabicSublabel")} defaultValue={lines(defaults?.inclusions?.ar)} className={inputClass} />
          <textarea name="inclusionsEn" rows={3} dir="ltr" aria-label={t("englishSublabel")} placeholder={t("englishSublabel")} defaultValue={lines(defaults?.inclusions?.en)} className={inputClass} />
        </div>
        <span className="text-xs text-foreground/50">{t("listHint")}</span>
      </div>

      {/* Exclusions (bilingual, one item per line) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/70">{t("exclusionsLabel")}</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <textarea name="exclusionsAr" rows={3} dir="rtl" aria-label={t("arabicSublabel")} placeholder={t("arabicSublabel")} defaultValue={lines(defaults?.exclusions?.ar)} className={inputClass} />
          <textarea name="exclusionsEn" rows={3} dir="ltr" aria-label={t("englishSublabel")} placeholder={t("englishSublabel")} defaultValue={lines(defaults?.exclusions?.en)} className={inputClass} />
        </div>
        <span className="text-xs text-foreground/50">{t("listHint")}</span>
      </div>

      {/* Customer requirements (bilingual, one item per line) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/70">{t("requirementsLabel")}</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <textarea name="requirementsAr" rows={3} dir="rtl" aria-label={t("arabicSublabel")} placeholder={t("arabicSublabel")} defaultValue={lines(defaults?.customerRequirements?.ar)} className={inputClass} />
          <textarea name="requirementsEn" rows={3} dir="ltr" aria-label={t("englishSublabel")} placeholder={t("englishSublabel")} defaultValue={lines(defaults?.customerRequirements?.en)} className={inputClass} />
        </div>
        <span className="text-xs text-foreground/50">{t("requirementsHint")}</span>
      </div>
    </fieldset>
  );
}
