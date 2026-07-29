import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, PackageOpen } from "lucide-react";
import { getProviderServiceOptions } from "@/lib/provider/queries/get-provider-service-options";
import { createAvailabilitySlot } from "@/lib/provider/create-availability-slot";
import { isAvailabilityActionErrorCode, getAvailabilityErrorTranslationKey } from "@/lib/provider/availability-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Availability Slot — Phase 4.2 (Provider Experience),
// Priority 2. A single slot for one of the provider's own services —
// see create-availability-slots-bulk.ts's own page for repeating this
// across a date range.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewAvailabilitySlotPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const services = await getProviderServiceOptions();
  const errorMessage = error && isAvailabilityActionErrorCode(error) ? t(getAvailabilityErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/availability"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToAvailabilityLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createSlotTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      {services.length === 0 ? (
        <EmptyState icon={PackageOpen} message={t("noServicesForSlotLabel")} />
      ) : (
        <Card hoverLift={false}>
          <form
            action={async (formData: FormData) => {
              "use server";
              const result = await createAvailabilitySlot(formData);
              if (!result.ok) {
                redirect({ href: `/provider/availability/new?error=${result.error}`, locale });
                return;
              }
              redirect({ href: "/provider/availability", locale });
            }}
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceLabel")}</span>
              <select
                name="serviceId"
                required
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("startTimeLabel")}</span>
                <input
                  type="datetime-local"
                  name="startTime"
                  required
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("endTimeLabel")}</span>
                <input
                  type="datetime-local"
                  name="endTime"
                  required
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 sm:w-48">
              <span className="text-xs font-medium text-foreground/50">{t("capacityFieldLabel")}</span>
              <input
                type="number"
                name="capacity"
                min={1}
                step={1}
                required
                defaultValue={1}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("createSlotSubmitButton")}
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
