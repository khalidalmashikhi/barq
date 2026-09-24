"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { rentalActionMessageKey, rentalErrorField, type RentalActionCode } from "@/lib/offerings/rental/provider/rental-action-result";
import { updateRentalOfferingAction } from "../actions";

// Phase 3C Slice C2d-R1 Checkpoint B — edit-offering form (client, useActionState). Edits only what
// the C2b-R update mutation supports: base daily price, currency (DRAFT-only + no overrides — the
// field is disabled when locked, and the domain re-enforces), and the capacity override. Service and
// Vehicle identity are immutable and never exposed. Entered values are retained on error; success is
// only shown after the server action confirms (no optimism). Archived offerings render read-only (the
// parent does not mount this form).

type EditState = { status: "idle" } | { status: "ok" } | { status: "error"; code: RentalActionCode };

export function EditOfferingForm({
  offeringId,
  baseDailyAmount,
  currency,
  offeringCapacityOverride,
  currencyLocked,
}: {
  offeringId: string;
  baseDailyAmount: string;
  currency: string;
  offeringCapacityOverride: number | null;
  currencyLocked: boolean;
}) {
  const t = useTranslations("provider");
  const tt = t as unknown as (key: string) => string;
  const router = useRouter();

  const [state, formAction, isPending] = useActionState(
    async (_prev: EditState, formData: FormData): Promise<EditState> => {
      const capacityRaw = String(formData.get("offeringCapacityOverride") ?? "").trim();
      const res = await updateRentalOfferingAction({
        offeringId,
        baseDailyAmount: String(formData.get("baseDailyAmount") ?? "").trim(),
        // Only send currency when the field is editable; when locked the input is disabled and omitted.
        currency: currencyLocked ? undefined : String(formData.get("currency") ?? "").trim(),
        offeringCapacityOverride: capacityRaw === "" ? null : capacityRaw,
      });
      if (res.ok) return { status: "ok" };
      return { status: "error", code: res.code };
    },
    { status: "idle" },
  );

  // Refresh authoritative server data after a confirmed update (never optimistic).
  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);

  const errorCode = state.status === "error" ? state.code : null;
  const errorField = errorCode ? rentalErrorField(errorCode) : null;
  const formError = errorCode && errorField === null ? tt(rentalActionMessageKey(errorCode)) : null;
  const fieldError = (field: string) => (errorCode && errorField === field ? tt(rentalActionMessageKey(errorCode)) : null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.status === "ok" && <Alert variant="success">{t("rentalEditSaved")}</Alert>}
      {formError && <Alert variant="danger">{formError}</Alert>}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalBasePriceLabel")}</span>
        <div className="flex items-center gap-2">
          <input name="baseDailyAmount" inputMode="decimal" defaultValue={baseDailyAmount} required aria-invalid={fieldError("baseDailyAmount") ? true : undefined}
            className="min-h-11 flex-1 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          <input name="currency" defaultValue={currency} disabled={currencyLocked} aria-label={t("rentalCurrencyLabel")}
            className="min-h-11 w-24 rounded-lg border border-border bg-card px-3 uppercase disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        </div>
        <span className="text-xs text-foreground/60">{t("rentalPricedPerVehiclePerDay")}</span>
        {currencyLocked && <span className="text-xs text-foreground/60">{t("rentalCurrencyLockedHint")}</span>}
        {fieldError("baseDailyAmount") && <span className="text-xs text-danger">{fieldError("baseDailyAmount")}</span>}
        {fieldError("currency") && <span className="text-xs text-danger">{fieldError("currency")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalCapacityOverrideLabel")}</span>
        <input name="offeringCapacityOverride" inputMode="numeric" defaultValue={offeringCapacityOverride ?? ""} aria-invalid={fieldError("offeringCapacityOverride") ? true : undefined}
          className="min-h-11 w-32 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        <span className="text-xs text-foreground/60">{t("rentalCapacityOverrideHint")}</span>
        {fieldError("offeringCapacityOverride") && <span className="text-xs text-danger">{fieldError("offeringCapacityOverride")}</span>}
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
          {t("rentalEditSubmit")}
        </SubmitButton>
        {isPending && <span className="text-sm text-foreground/60">{t("rentalSaving")}</span>}
      </div>
    </form>
  );
}
