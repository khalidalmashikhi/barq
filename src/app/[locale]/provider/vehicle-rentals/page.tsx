import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { CarFront, Package, FileText, BadgeCheck, Ban, Car, ShieldAlert, CalendarDays, Users, AlertTriangle } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { listProviderRentalOfferings } from "@/lib/offerings/rental/provider/list-provider-rental-offerings";
import { getProviderRentalWorkspaceOverview } from "@/lib/offerings/rental/provider/get-provider-rental-overview";
import {
  getRentalOfferingStatusBadgeVariant,
  getRentalOfferingStatusTranslationKey,
  getRentalBlockerTranslationKey,
} from "@/lib/offerings/rental/provider/rental-offering-status";
import { dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { formatMoney } from "@/lib/i18n/format-money";
import { formatDate } from "@/lib/i18n/format-date";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/provider/kpi-card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/locales";

// Phase 3C Slice C2d-R1 — the RENTAL_COMPANY vehicle-rental management workspace root: an operational
// overview + the provider's own offering list. READ-ONLY foundation (Checkpoint A): create / edit /
// calendar mutations / publish UX arrive in Checkpoint B. Auth is enforced by provider/layout.tsx
// AND independently by each read model's requireApprovedProvider() (the real boundary). Responsive
// card layout (never a dense table); logical RTL-safe utilities throughout.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProviderVehicleRentalsPage() {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let overview;
  let offerings;
  try {
    [overview, offerings] = await Promise.all([getProviderRentalWorkspaceOverview(), listProviderRentalOfferings()]);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const typeLabel = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));
  const formatDay = (dateKey: string) => {
    const date = dbDateFromOmanDateKey(dateKey);
    return date ? formatDate(date, locale as Locale, { day: "numeric", month: "short", year: "numeric" }) : dateKey;
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t("rentalWorkspaceTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/70">{t("rentalWorkspaceSubtitle")}</p>
        <p className="mt-2 text-xs text-foreground/60">{t("rentalPricedPerVehiclePerDay")}</p>
      </header>

      {/* Overview — authoritative operational counts. */}
      <section aria-labelledby="rental-overview-heading" className="flex flex-col gap-3">
        <h2 id="rental-overview-heading" className="text-sm font-medium text-foreground/80">
          {t("rentalOverviewHeading")}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <KpiCard label={t("rentalMetricTotalOfferings")} value={String(overview.totalOfferings)} icon={Package} />
          <KpiCard label={t("rentalMetricDraft")} value={String(overview.draftOfferings)} icon={FileText} />
          <KpiCard label={t("rentalMetricPublished")} value={String(overview.publishedOfferings)} icon={BadgeCheck} tone="success" />
          <KpiCard label={t("rentalMetricSuspended")} value={String(overview.suspendedOfferings)} icon={Ban} />
          <KpiCard label={t("rentalMetricVehiclesReady")} value={String(overview.vehiclesReadyForRental)} icon={Car} tone="success" />
          <KpiCard
            label={t("rentalMetricVehiclesRequiringVerification")}
            value={String(overview.vehiclesRequiringVerification)}
            icon={ShieldAlert}
            tone={overview.vehiclesRequiringVerification > 0 ? "danger" : "default"}
          />
          <KpiCard label={t("rentalMetricUpcomingOpenDays")} value={String(overview.upcomingOpenDays)} icon={CalendarDays} />
        </div>
      </section>

      {/* Offering list. */}
      <section aria-labelledby="rental-offerings-heading" className="flex flex-col gap-3">
        <h2 id="rental-offerings-heading" className="text-sm font-medium text-foreground/80">
          {t("rentalOfferingsHeading")}
        </h2>

        {offerings.length === 0 ? (
          <EmptyState
            icon={CarFront}
            message={t("rentalNoOfferingsLabel")}
            description={t("rentalNoOfferingsDescription")}
            gap="gap-3"
            padding="py-16"
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((offering) => {
              const title = offering.vehicleTitle ?? t("rentalVehicleUntitled");
              const typeText = offering.vehicleType ? (typeLabel.get(offering.vehicleType) ?? offering.vehicleType) : null;
              return (
                <li key={offering.id}>
                  <Link
                    href={`/provider/vehicle-rentals/${offering.id}`}
                    className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <CarFront size={18} strokeWidth={1.75} aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold leading-snug text-foreground">{title}</h3>
                          <p className="truncate text-xs text-foreground/60">{offering.serviceName}</p>
                        </div>
                      </div>
                      <Badge variant={getRentalOfferingStatusBadgeVariant(offering.status)}>
                        {t(getRentalOfferingStatusTranslationKey(offering.status))}
                      </Badge>
                    </div>

                    {typeText && <p className="text-sm text-foreground/60">{typeText}</p>}

                    <p className="text-sm font-medium text-foreground">
                      {formatMoney(offering.baseDailyAmount, offering.currency, locale)}
                      <span className="text-xs font-normal text-foreground/60"> · {t("rentalPerDaySuffix")}</span>
                    </p>

                    {offering.effectiveCapacity ? (
                      <span className="flex items-center gap-1 text-xs text-foreground/70">
                        <Users size={13} strokeWidth={1.75} aria-hidden />
                        {t("rentalMaxPassengersValue", { count: offering.effectiveCapacity })}
                      </span>
                    ) : null}

                    <span className="text-xs text-foreground/60">
                      {offering.nearestOpenDateKey
                        ? t("rentalNextAvailableLabel", { date: formatDay(offering.nearestOpenDateKey) })
                        : t("rentalNoAvailableDaysLabel")}
                    </span>

                    {offering.readinessBlocker ? (
                      <span className="mt-auto inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                        <AlertTriangle size={13} strokeWidth={2} aria-hidden />
                        {t(getRentalBlockerTranslationKey(offering.readinessBlocker))}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
