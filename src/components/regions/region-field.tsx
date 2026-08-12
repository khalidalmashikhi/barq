import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { REGION_CODES, REGION_LABEL_KEYS } from "@/lib/regions";

// RegionField — the shared governorate <select> for the provider/admin service
// forms (Core Service Enrichment, Gate 4).
//
// A native, JS-free, accessible select that SUBMITS the stable governorate CODE
// (e.g. DHOFAR) while DISPLAYING the localized name (e.g. "Dhofar" / "ظفار"), so a
// provider/admin never types a persisted code and the DB never stores a localized
// label. It consumes the authoritative src/lib/regions registry (never a
// duplicated governorate list) and resolves labels from the `common` i18n
// namespace via REGION_LABEL_KEYS. Async server component — composes inside the
// existing server-action <form>s exactly like their native inputs.
//
// An existing service with regionCode = null renders unselected (the placeholder);
// no default governorate is fabricated.

type RegionFieldProps = {
  // The current Service.regionCode to preselect. An edit form passes the stored
  // code; a create form passes null. An unknown/absent value falls back to the
  // unselected placeholder rather than injecting a non-option value.
  defaultValue?: string | null;
  name?: string;
  id?: string;
};

export async function RegionField({ defaultValue = null, name = "regionCode", id = "regionCode" }: RegionFieldProps) {
  const t = await getServerTranslator("common");
  const selected =
    defaultValue && (REGION_CODES as readonly string[]).includes(defaultValue) ? defaultValue : "";

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground/50">{t("governorate.fieldLabel")}</span>
      <select
        id={id}
        name={name}
        defaultValue={selected}
        className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="">{t("governorate.placeholder")}</option>
        {REGION_CODES.map((code) => (
          <option key={code} value={code}>
            {t(REGION_LABEL_KEYS[code])}
          </option>
        ))}
      </select>
    </label>
  );
}
