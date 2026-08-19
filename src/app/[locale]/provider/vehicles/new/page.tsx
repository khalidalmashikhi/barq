import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createVehicle } from "@/lib/vehicles/create-vehicle";
import { formDataToVehicleInput } from "@/lib/vehicles/vehicle-form";
import { isVehicleActionErrorCode, getVehicleErrorTranslationKey } from "@/lib/vehicles/vehicle-errors";
import { VehicleFormFields } from "@/components/provider/vehicle-form-fields";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Add Vehicle — VEHICLE-2. The inline server action forwards the FormData through
// the VEHICLE-1 domain contract (createVehicle): providerId is derived server-
// side, assetType is forced to VEHICLE, and status starts REGISTERED — the form
// exposes NONE of those. No Prisma is touched here. On success we redirect to the
// new vehicle's detail; on a domain error we bounce back with a ?error code.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewVehiclePage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const errorMessage = error && isVehicleActionErrorCode(error) ? t(getVehicleErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/vehicles"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("addVehicleButton")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createVehicle(formDataToVehicleInput(formData));
            if (!result.ok) {
              redirect({ href: `/provider/vehicles/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/vehicles/${result.vehicleId}`, locale });
          }}
          className="flex flex-col gap-8"
        >
          <VehicleFormFields />

          <div className="flex items-center gap-3">
            <SubmitButton className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("vehicleSaveButton")}
            </SubmitButton>
            <Link
              href="/provider/vehicles"
              className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("vehicleCancelLabel")}
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
