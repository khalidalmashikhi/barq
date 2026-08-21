import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { getProviderVehicle } from "@/lib/vehicles/queries/get-provider-vehicle";
import { updateVehicle } from "@/lib/vehicles/update-vehicle";
import { formDataToVehicleInput } from "@/lib/vehicles/vehicle-form";
import { isVehicleActionErrorCode, getVehicleErrorTranslationKey } from "@/lib/vehicles/vehicle-errors";
import { VehicleFormFields } from "@/components/provider/vehicle-form-fields";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Edit Vehicle — VEHICLE-2. Hydrates the caller's OWN vehicle (getProviderVehicle
// is ownership-scoped → foreign/missing → notFound). The inline server action
// forwards through updateVehicle(), which re-checks ownership and mutates only the
// VEHICLE-1 editable fields — the form exposes NO providerId/assetType/status
// input, so none can be changed here. No Prisma is touched in this page.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function EditVehiclePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const vehicle = await getProviderVehicle(id);
  if (!vehicle) {
    notFound();
  }

  const errorMessage = error && isVehicleActionErrorCode(error) ? t(getVehicleErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href={`/provider/vehicles/${vehicle.id}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("editVehicleButton")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateVehicle(id, formDataToVehicleInput(formData));
            if (!result.ok) {
              redirect({ href: `/provider/vehicles/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/vehicles/${id}`, locale });
          }}
          className="flex flex-col gap-8"
        >
          <VehicleFormFields
            defaults={{
              make: vehicle.make,
              model: vehicle.model,
              modelYear: vehicle.modelYear,
              color: vehicle.color,
              vehicleType: vehicle.vehicleType,
              passengerCapacity: vehicle.passengerCapacity,
              registrationNumber: vehicle.registrationNumber,
              publicDescription: vehicle.publicDescription,
              claimedFourByFour: vehicle.claimedFourByFour,
            }}
          />

          <div className="flex items-center gap-3">
            <SubmitButton className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("vehicleSaveButton")}
            </SubmitButton>
            <Link
              href={`/provider/vehicles/${vehicle.id}`}
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
