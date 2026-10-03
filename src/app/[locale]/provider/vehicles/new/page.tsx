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
import { resolveRentalWorkspaceViewAccess } from "@/lib/offerings/rental/provider/rental-workspace-access";

// Add Vehicle. Two creation flows share this entry:
//
//   • RENTAL_COMPANY providers (Phase 3C Slice 3B) get the DOCUMENT-FIRST onboarding wizard — step 1
//     here uploads the registration document (via the multipart onboarding route, which creates a
//     blank DRAFT shell and attempts native-PDF extraction), then step 2 (/new/[vehicleId]) reviews
//     and confirms. No Vehicle values are entered or created until that confirmed finalize.
//   • Every other approved provider keeps the original VEHICLE-2 direct form (createVehicle) —
//     preserved unchanged so non-rental vehicle creation is never removed.
//
// In both flows providerId is server-derived and status starts REGISTERED; the form exposes none of
// that. No Prisma is touched in this file.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UPLOAD_ERROR_KEY: Record<string, string> = {
  EMPTY_FILE: "vehicleOnboardUploadEmptyFile",
  STORAGE_NOT_CONFIGURED: "vehicleOnboardErrStorage",
  NOT_RENTAL_PROVIDER: "vehicleOnboardErrNoAccess",
};

type Props = { searchParams: Promise<{ error?: string; uploadError?: string }> };

export default async function NewVehiclePage({ searchParams }: Props) {
  const { error, uploadError } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const access = await resolveRentalWorkspaceViewAccess();

  // ── Document-first wizard (RENTAL_COMPANY) ──────────────────────────────────────────────────
  if (access.ok) {
    const uploadErrorMessage = uploadError ? t((UPLOAD_ERROR_KEY[uploadError] ?? "vehicleOnboardUploadFailed") as "vehicleOnboardUploadFailed") : null;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
        <Link href="/provider/vehicles" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
          {t("backToVehiclesLabel")}
        </Link>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{t("vehicleOnboardUploadTitle")}</h1>
          <p className="text-sm text-foreground/60">{t("vehicleOnboardUploadSubtitle")}</p>
        </div>

        {uploadErrorMessage && <Alert variant="danger">{uploadErrorMessage}</Alert>}

        <Card hoverLift={false}>
          <form action="/api/provider/vehicles/onboarding/upload" method="post" encType="multipart/form-data" className="flex flex-col gap-5">
            <input type="hidden" name="locale" value={locale} />
            <div className="flex flex-col gap-2">
              <label htmlFor="registration-file" className="text-sm font-medium text-foreground">
                {t("vehicleOnboardFileLabel")}
              </label>
              <input
                id="registration-file"
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
                required
                className="block w-full text-sm file:me-4 file:min-h-11 file:rounded-full file:border-0 file:bg-primary file:px-5 file:text-sm file:font-medium file:text-primary-foreground"
              />
              <p className="text-xs text-foreground/50">{t("vehicleOnboardFileHint")}</p>
            </div>
            <SubmitButton className="w-fit rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("vehicleOnboardUploadButton")}
            </SubmitButton>
          </form>
        </Card>
      </div>
    );
  }

  // ── Legacy direct form (all other approved providers) — preserved unchanged ──────────────────
  const errorMessage = error && isVehicleActionErrorCode(error) ? t(getVehicleErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/provider/vehicles" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
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
