import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Car, Plus, Users } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderVehicles } from "@/lib/vehicles/queries/get-provider-vehicles";
import { getVehicleStatusBadgeVariant, getVehicleStatusTranslationKey } from "@/lib/vehicles/presentation/vehicle-status";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Provider "My Vehicles" — VEHICLE-2. The owner workspace list. Read-only auth is
// handled by provider/layout.tsx and, independently, by getProviderVehicles()'s
// own requireApprovedProvider() (foreign vehicles are never returned). Responsive
// CARD grid (not an admin table); no activation/verification/delete/booking/tour/
// availability controls — those are out of scope / deferred. registrationNumber
// appears as a private secondary line (this is the owner's own workspace).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProviderVehiclesPage() {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let vehicles;
  try {
    vehicles = await getProviderVehicles();
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

  // Localized type label per canonical code (reused registry; value stays the code).
  const typeLabel = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("vehiclesTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/50">{t("vehiclesSubtitle")}</p>
        </div>
        <Link
          href="/provider/vehicles/new"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} aria-hidden />
          {t("addVehicleButton")}
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          message={t("noVehiclesLabel")}
          description={t("noVehiclesDescription")}
          gap="gap-3"
          padding="py-16"
          action={
            <Link
              href="/provider/vehicles/new"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Plus size={16} strokeWidth={2} aria-hidden />
              {t("addVehicleButton")}
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => {
            const title = buildVehicleTitle(v.make, v.model) ?? t("vehicleUntitled");
            const facts = [
              v.modelYear ? String(v.modelYear) : null,
              v.vehicleType ? (typeLabel.get(v.vehicleType) ?? v.vehicleType) : null,
              v.color,
            ].filter((f): f is string => Boolean(f));
            return (
              <li key={v.id}>
                <Link
                  href={`/provider/vehicles/${v.id}`}
                  className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Car size={18} strokeWidth={1.75} aria-hidden />
                      </span>
                      <h2 className="font-semibold leading-snug text-foreground">{title}</h2>
                    </div>
                    <Badge variant={getVehicleStatusBadgeVariant(v.status)}>{t(getVehicleStatusTranslationKey(v.status))}</Badge>
                  </div>

                  {facts.length > 0 && <p className="text-sm text-foreground/60">{facts.join(" · ")}</p>}

                  {v.passengerCapacity ? (
                    <span className="flex items-center gap-1 text-xs text-foreground/50">
                      <Users size={13} strokeWidth={1.75} aria-hidden />
                      {v.passengerCapacity}
                    </span>
                  ) : null}

                  {v.registrationNumber ? (
                    <span className="mt-auto text-xs text-foreground/40">
                      {t("vehicleRegistrationLabel")}: {v.registrationNumber}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
