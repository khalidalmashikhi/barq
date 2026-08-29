import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { PRICING_UNIT_LABEL_KEYS } from "@/lib/pricing-units";
import { BOOKABLE_PRICING_UNIT_CODES } from "@/lib/pricing-units/billability";

// PricingUnitField — the shared pricing-unit <select> for the provider/admin
// service forms (Core Service Enrichment, Gate 4). Mirrors RegionField exactly.
//
// Submits the stable unit CODE (e.g. PER_PERSON) while displaying the localized
// label (e.g. "per person" / "للشخص"). Consumes the authoritative
// src/lib/pricing-units registry (never a duplicated unit list) and resolves
// labels from the `common` i18n namespace. pricingUnit is DISPLAY METADATA ONLY —
// choosing a unit here never affects booking totals or payment.
//
// Rendered alongside the price input. An existing Price with pricingUnit = null
// renders unselected; no default unit is fabricated.

type PricingUnitFieldProps = {
  defaultValue?: string | null;
  name?: string;
  id?: string;
};

export async function PricingUnitField({
  defaultValue = null,
  name = "pricingUnit",
  id = "pricingUnit",
}: PricingUnitFieldProps) {
  const t = await getServerTranslator("common");
  // Only BOOKABLE units are offered: a new/edited ACTIVE price must be priceable, so the
  // reserved duration units (PER_DAY/PER_HOUR) are never selectable. `required` (with the
  // empty placeholder) forces an explicit choice — no unit is ever defaulted for the provider.
  const selected =
    defaultValue && (BOOKABLE_PRICING_UNIT_CODES as readonly string[]).includes(defaultValue) ? defaultValue : "";

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground/50">{t("pricingUnit.fieldLabel")}</span>
      <select
        id={id}
        name={name}
        defaultValue={selected}
        required
        className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="">{t("pricingUnit.placeholder")}</option>
        {BOOKABLE_PRICING_UNIT_CODES.map((code) => (
          <option key={code} value={code}>
            {t(PRICING_UNIT_LABEL_KEYS[code])}
          </option>
        ))}
      </select>
    </label>
  );
}
