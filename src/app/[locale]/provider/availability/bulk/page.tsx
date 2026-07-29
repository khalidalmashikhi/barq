import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, PackageOpen } from "lucide-react";
import { getProviderServiceOptions } from "@/lib/provider/queries/get-provider-service-options";
import { createAvailabilitySlotsBulk } from "@/lib/provider/create-availability-slots-bulk";
import { isAvailabilityActionErrorCode, getAvailabilityErrorTranslationKey } from "@/lib/provider/availability-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Bulk-create Availability Slots — Phase 4.2 (Provider Experience),
// Priority 2's "Bulk actions where appropriate". Repeats one time-of-
// day window daily across a date range — see
// create-availability-slots-bulk.ts's own note on why this specific
// shape (not a full recurrence-rule engine).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function BulkCreateAvailabilityPage({ searchParams }: Props) {
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

      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("bulkCreateTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("bulkCreateDescription")}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      {services.length === 0 ? (
        <EmptyState icon={PackageOpen} message={t("noServicesForSlotLabel")} />
      ) : (
        <Card hoverLift={false}>
          <form
            action={async (formData: FormData) => {
              "use server";
              const result = await createAvailabilitySlotsBulk(formData);
              if (!result.ok) {
                redirect({ href: `/provider/availability/bulk?error=${result.error}`, locale });
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
                <span className="text-xs font-medium text-foreground/50">{t("startDateLabel")}</span>
                <input
                  type="date"
                  name="startDate"
                  required
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("endDateLabel")}</span>
                <input
                  type="date"
                  name="endDate"
                  required
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("startTimeOfDayLabel")}</span>
                <input
                  type="time"
                  name="startTimeOfDay"
                  required
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("endTimeOfDayLabel")}</span>
                <input
                  type="time"
                  name="endTimeOfDay"
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
              {t("bulkCreateSubmitButton")}
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
