import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";

// VEHICLE-2 — the shared field set for the Add/Edit vehicle forms (server
// component, no client JS). Renders ONLY the VEHICLE-1-authorized fields, grouped
// with accessible <fieldset>/<legend> sections and real <label>s. There is no
// providerId/assetType/status input — those are server-derived/immutable. The
// vehicle-type <select> submits the canonical CODE (untranslated); only its label
// is localized. `defaults` hydrates the Edit form; absent for Add.

const INPUT_CLASS =
  "rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export type VehicleFieldDefaults = {
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  color?: string | null;
  vehicleType?: string | null;
  passengerCapacity?: number | null;
  registrationNumber?: string | null;
  publicDescription?: string | null;
  claimedFourByFour?: boolean | null;
};

function labelSpan(text: string, hint?: string) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-foreground/50">{text}</span>
      {hint ? <span className="text-[0.7rem] font-normal text-foreground/40">{hint}</span> : null}
    </span>
  );
}

export async function VehicleFormFields({ defaults }: { defaults?: VehicleFieldDefaults }) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();
  const typeOptions = vehicleTypeOptions(locale);

  return (
    <div className="flex flex-col gap-8">
      {/* SECTION A — Basic information */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-foreground">{t("vehicleSectionBasic")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehicleMakeLabel"))}
            <input type="text" name="make" required maxLength={100} defaultValue={defaults?.make ?? ""} className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehicleModelLabel"))}
            <input type="text" name="model" required maxLength={100} defaultValue={defaults?.model ?? ""} className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehicleModelYearLabel"))}
            <input type="number" name="modelYear" min={1950} max={2100} step={1} defaultValue={defaults?.modelYear ?? ""} className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehicleColorLabel"))}
            <input type="text" name="color" maxLength={50} defaultValue={defaults?.color ?? ""} className={INPUT_CLASS} />
          </label>
        </div>
      </fieldset>

      {/* SECTION B — Vehicle specifications */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-foreground">{t("vehicleSectionSpecs")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehicleTypeLabel"))}
            <select name="vehicleType" required defaultValue={defaults?.vehicleType ?? ""} className={INPUT_CLASS}>
              <option value="" disabled>
                {t("vehicleTypeSelectPlaceholder")}
              </option>
              {typeOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            {labelSpan(t("vehiclePassengerCapacityLabel"), t("vehiclePassengerCapacityHint"))}
            <input type="number" name="passengerCapacity" required min={1} max={100} step={1} defaultValue={defaults?.passengerCapacity ?? ""} className={INPUT_CLASS} />
          </label>
        </div>
        {/* TOUR-VEHICLE-CAP — provider's advisory 4x4 declaration (subject to BARQ verification). */}
        <label className="flex items-start gap-2">
          <input type="checkbox" name="claimedFourByFour" value="true" defaultChecked={defaults?.claimedFourByFour === true} className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{t("vehicleClaimedFourByFourLabel")}</span>
            <span className="text-[0.7rem] text-foreground/40">{t("vehicleClaimedFourByFourHint")}</span>
          </span>
        </label>
      </fieldset>

      {/* SECTION C — Registration (PRIVATE) */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-foreground">{t("vehicleSectionRegistration")}</legend>
        <label className="flex flex-col gap-1.5">
          {labelSpan(t("vehicleRegistrationLabel"), t("vehicleRegistrationHint"))}
          <input type="text" name="registrationNumber" maxLength={32} defaultValue={defaults?.registrationNumber ?? ""} className={INPUT_CLASS} />
        </label>
      </fieldset>

      {/* SECTION D — Description */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-foreground">{t("vehicleSectionDescription")}</legend>
        <label className="flex flex-col gap-1.5">
          {labelSpan(t("vehiclePublicDescriptionLabel"))}
          <textarea name="publicDescription" rows={3} maxLength={500} defaultValue={defaults?.publicDescription ?? ""} className={INPUT_CLASS} />
        </label>
      </fieldset>
    </div>
  );
}
