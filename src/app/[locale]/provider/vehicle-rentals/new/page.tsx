import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { resolveRentalWorkspaceViewAccess } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { getRentalCreateOptions } from "@/lib/offerings/rental/provider/get-rental-create-options";
import { Card } from "@/components/ui/card";
import { CreateOfferingForm } from "../_components/create-offering-form";

// Phase 3C Slice C2d-R1 Checkpoint B — create-offering workspace entry point. Gated by the SAME shared
// access decision as the nav + list/detail pages (a non-rental-company provider is denied via
// notFound(), non-enumerating). Options are the provider's own eligible services/vehicles; the create
// server action re-validates everything authoritatively.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const DEFAULT_RENTAL_CURRENCY = "OMR";

export default async function NewRentalOfferingPage() {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const access = await resolveRentalWorkspaceViewAccess();
  if (!access.ok) {
    if (access.reason === "UNAUTHENTICATED") redirect({ href: "/login", locale });
    else notFound();
    return null;
  }

  const options = await getRentalCreateOptions();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Link
        href="/provider/vehicle-rentals"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
        {t("rentalBackToWorkspace")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("rentalCreateTitle")}</h1>
      <p className="text-sm text-foreground/70">{t("rentalPricedPerVehiclePerDay")}</p>

      <Card hoverLift={false}>
        <CreateOfferingForm options={options} defaultCurrency={DEFAULT_RENTAL_CURRENCY} />
      </Card>
    </div>
  );
}
