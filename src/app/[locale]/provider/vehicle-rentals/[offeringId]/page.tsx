import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowLeft, CarFront, Users, Tag, CalendarDays, AlertTriangle } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { resolveRentalWorkspaceViewAccess } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { getProviderRentalOfferingWithDays } from "@/lib/offerings/rental/provider/get-provider-rental-offering";
import {
  getRentalOfferingStatusBadgeVariant,
  getRentalOfferingStatusTranslationKey,
  getRentalBlockerTranslationKey,
} from "@/lib/offerings/rental/provider/rental-offering-status";
import { formatMoney } from "@/lib/i18n/format-money";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { OfferingLifecyclePanel } from "../_components/offering-lifecycle-panel";
import { EditOfferingForm } from "../_components/edit-offering-form";
import { AvailabilityCalendar } from "../_components/availability-calendar";

// Phase 3C Slice C2d-R1 Checkpoint B — the provider's rental offering MANAGEMENT page: identity +
// commercial summary, lifecycle controls, an edit form, and the interactive configuration calendar.
// A foreign/missing offering resolves to notFound() (non-enumerating). All mutations go through
// Server Actions → the C2b-R domain authority. An ARCHIVED offering is fully read-only (no edit form;
// the calendar renders in read-only mode). The calendar is CONFIGURATION, not reservation-aware
// customer availability (C2c remains that authority).

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ProviderRentalOfferingDetailPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();
  const { offeringId } = await params;

  const access = await resolveRentalWorkspaceViewAccess();
  if (!access.ok) {
    if (access.reason === "UNAUTHENTICATED") redirect({ href: "/login", locale });
    else notFound();
    return null;
  }

  let offering;
  try {
    offering = await getProviderRentalOfferingWithDays(offeringId);
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
  if (!offering) {
    notFound();
    return null;
  }

  const typeLabel = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));
  const typeText = offering.vehicleType ? (typeLabel.get(offering.vehicleType) ?? offering.vehicleType) : null;
  const title = offering.vehicleTitle ?? t("rentalVehicleUntitled");
  const facts = [offering.vehicleModelYear ? String(offering.vehicleModelYear) : null, typeText, offering.vehicleColor].filter(
    (f): f is string => Boolean(f),
  );

  const isArchived = offering.status === "ARCHIVED";
  // Currency is editable only while DRAFT with NO day overrides anywhere. `hasAnyDailyOverride` is a
  // global existence check (not the visible window), so a past/out-of-window override still locks it.
  // The domain update mutation re-enforces this transactionally regardless.
  const currencyLocked = offering.status !== "DRAFT" || offering.hasAnyDailyOverride;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Link
        href="/provider/vehicle-rentals"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
        {t("rentalBackToWorkspace")}
      </Link>

      {/* Identity + commercial summary. */}
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CarFront size={20} strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              <p className="text-sm text-foreground/60">{offering.serviceName}</p>
            </div>
          </div>
          <Badge variant={getRentalOfferingStatusBadgeVariant(offering.status)}>
            {t(getRentalOfferingStatusTranslationKey(offering.status))}
          </Badge>
        </div>

        {facts.length > 0 && <p className="text-sm text-foreground/60">{facts.join(" · ")}</p>}

        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs text-foreground/60">{t("rentalBasePriceLabel")}</dt>
            <dd className="flex items-center gap-1 font-medium text-foreground">
              <Tag size={14} strokeWidth={1.75} aria-hidden />
              {formatMoney(offering.baseDailyAmount, offering.currency, locale)}
              <span className="text-xs font-normal text-foreground/60"> · {t("rentalPerDaySuffix")}</span>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-foreground/60">{t("rentalMaxPassengersLabel")}</dt>
            <dd className="flex items-center gap-1 font-medium text-foreground">
              <Users size={14} strokeWidth={1.75} aria-hidden />
              {offering.effectiveCapacity ? String(offering.effectiveCapacity) : t("rentalCapacityUnknown")}
            </dd>
          </div>
          {offering.registeredSeats !== null && (
            <div className="flex flex-col">
              <dt className="text-xs text-foreground/60">{t("rentalRegisteredSeatsLabel")}</dt>
              <dd className="font-medium text-foreground">{offering.registeredSeats}</dd>
            </div>
          )}
          <div className="flex flex-col">
            <dt className="text-xs text-foreground/60">{t("rentalUpcomingConfiguredOpenDaysLabel")}</dt>
            <dd className="flex items-center gap-1 font-medium text-foreground">
              <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
              {offering.upcomingConfiguredOpenDays}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-foreground/60">{t("rentalPassengersDoNotChangePrice")}</p>

        {offering.readinessBlocker ? (
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden />
            {t(getRentalBlockerTranslationKey(offering.readinessBlocker))}
          </p>
        ) : null}
      </header>

      {/* Lifecycle controls. */}
      <OfferingLifecyclePanel offeringId={offering.id} status={offering.status} />

      {/* Commercial edit — hidden for an ARCHIVED (immutable) offering. */}
      {!isArchived && (
        <section aria-labelledby="rental-edit-heading" className="flex flex-col gap-3">
          <h2 id="rental-edit-heading" className="text-sm font-medium text-foreground/80">{t("rentalEditHeading")}</h2>
          <Card hoverLift={false}>
            <EditOfferingForm
              offeringId={offering.id}
              baseDailyAmount={offering.baseDailyAmount}
              currency={offering.currency}
              offeringCapacityOverride={offering.offeringCapacityOverride}
              currencyLocked={currencyLocked}
            />
          </Card>
        </section>
      )}

      {/* Interactive configuration calendar (read-only when archived). */}
      <AvailabilityCalendar
        offeringId={offering.id}
        baseDailyAmount={offering.baseDailyAmount}
        currency={offering.currency}
        configuredDays={offering.configuredDays}
        todayKey={offering.todayKey}
        windowDays={offering.windowDays}
        locale={locale}
        readOnly={isArchived}
      />
    </div>
  );
}
