"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { rentalActionMessageKey, rentalErrorField, type RentalActionCode } from "@/lib/offerings/rental/provider/rental-action-result";
import type { RentalCreateOptions } from "@/lib/offerings/rental/provider/get-rental-create-options";
import { createRentalOfferingAction } from "../actions";

// Phase 3C Slice C2d-R1 Checkpoint B — create-offering form (client, useActionState). Only the
// provider's own VEHICLE_RENTAL services and own vehicles are selectable (server-derived options; the
// create mutation re-validates ownership/kind/uniqueness/vertical). Pricing is per vehicle, per day —
// there is deliberately NO per-passenger or per-hour field, and passenger capacity is shown as
// capacity only. Entered values are retained on error (uncontrolled inputs); success navigates to the
// new offering's workspace. No optimistic success.

type CreateState = { status: "idle" } | { status: "ok"; offeringId: string } | { status: "error"; code: RentalActionCode };

export function CreateOfferingForm({ options, defaultCurrency }: { options: RentalCreateOptions; defaultCurrency: string }) {
  const t = useTranslations("provider");
  const tt = t as unknown as (key: string) => string;
  const router = useRouter();

  const [state, formAction, isPending] = useActionState(
    async (_prev: CreateState, formData: FormData): Promise<CreateState> => {
      const capacityRaw = String(formData.get("offeringCapacityOverride") ?? "").trim();
      const res = await createRentalOfferingAction({
        serviceId: formData.get("serviceId"),
        vehicleId: formData.get("vehicleId"),
        baseDailyAmount: String(formData.get("baseDailyAmount") ?? "").trim(),
        currency: String(formData.get("currency") ?? "").trim(),
        offeringCapacityOverride: capacityRaw === "" ? undefined : capacityRaw,
      });
      return res.ok ? { status: "ok", offeringId: res.offeringId } : { status: "error", code: res.code };
    },
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "ok") router.replace(`/provider/vehicle-rentals/${state.offeringId}`);
  }, [state, router]);

  const errorCode = state.status === "error" ? state.code : null;
  const errorField = errorCode ? rentalErrorField(errorCode) : null;
  const formError = errorCode && errorField === null ? tt(rentalActionMessageKey(errorCode)) : null;
  const fieldError = (field: string) => (errorCode && errorField === field ? tt(rentalActionMessageKey(errorCode)) : null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {formError && <Alert variant="danger">{formError}</Alert>}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalCreateServiceLabel")}</span>
        <select name="serviceId" required aria-invalid={fieldError("service") ? true : undefined}
          className="min-h-11 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <option value="">{t("rentalCreateServicePlaceholder")}</option>
          {options.services.map((s) => <option key={s.serviceId} value={s.serviceId}>{s.serviceName}</option>)}
        </select>
        {options.services.length === 0 && <span className="text-xs text-foreground/60">{t("rentalCreateNoServices")}</span>}
        {fieldError("service") && <span className="text-xs text-danger">{fieldError("service")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalCreateVehicleLabel")}</span>
        <select name="vehicleId" required aria-invalid={fieldError("vehicle") ? true : undefined}
          className="min-h-11 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <option value="">{t("rentalCreateVehiclePlaceholder")}</option>
          {options.vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {(v.title ?? t("rentalVehicleUntitled")) +
                (v.bookablePassengerCapacity ? ` · ${t("rentalMaxPassengersValue", { count: v.bookablePassengerCapacity })}` : "") +
                (v.ready ? "" : ` · ${t("rentalCreateVehicleNotReady")}`)}
            </option>
          ))}
        </select>
        {options.vehicles.length === 0 && <span className="text-xs text-foreground/60">{t("rentalCreateNoVehicles")}</span>}
        {fieldError("vehicle") && <span className="text-xs text-danger">{fieldError("vehicle")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalBasePriceLabel")}</span>
        <div className="flex items-center gap-2">
          <input name="baseDailyAmount" inputMode="decimal" required aria-invalid={fieldError("baseDailyAmount") ? true : undefined}
            className="min-h-11 flex-1 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          <input name="currency" defaultValue={defaultCurrency} required aria-label={t("rentalCurrencyLabel")}
            className="min-h-11 w-24 rounded-lg border border-border bg-card px-3 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        </div>
        <span className="text-xs text-foreground/60">{t("rentalPricedPerVehiclePerDay")}</span>
        {fieldError("baseDailyAmount") && <span className="text-xs text-danger">{fieldError("baseDailyAmount")}</span>}
        {fieldError("currency") && <span className="text-xs text-danger">{fieldError("currency")}</span>}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("rentalCapacityOverrideLabel")}</span>
        <input name="offeringCapacityOverride" inputMode="numeric" aria-invalid={fieldError("offeringCapacityOverride") ? true : undefined}
          className="min-h-11 w-32 rounded-lg border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        <span className="text-xs text-foreground/60">{t("rentalCapacityOverrideHint")}</span>
        {fieldError("offeringCapacityOverride") && <span className="text-xs text-danger">{fieldError("offeringCapacityOverride")}</span>}
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
          {t("rentalCreateSubmit")}
        </SubmitButton>
        {isPending && <span className="text-sm text-foreground/60">{t("rentalSaving")}</span>}
      </div>
    </form>
  );
}
