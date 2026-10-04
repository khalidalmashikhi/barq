import type { Metadata } from "next";
import { createHash, randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { resolveVehicleCreateAccess } from "@/lib/vehicles/onboarding/vehicle-create-access";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { isOnboardingRequestErrorCode, getOnboardingRequestErrorTranslationKey } from "@/lib/vehicles/onboarding/onboarding-request-errors";
import { isRegistrationOcrOperational } from "@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader";
import { RegistrationUploadForm } from "./_components/registration-upload-form";

// Add Vehicle — DOCUMENT-FIRST for every provider who may register a vehicle (Phase 3C Slice 3B).
//
// Creating a vehicle always begins by uploading its registration document. This page renders ONLY
// that upload step — there is no make/model/capacity field here and no direct-create action. The
// multipart POST goes to the onboarding route, which creates a blank non-public shell, stores the
// document privately and (for a native-text PDF) reads it; the provider then reviews and explicitly
// confirms on /new/[vehicleId].
//
// AUTHORITY: the general vehicle-create rule only (an APPROVED provider — resolveVehicleCreateAccess).
// It never consults the rental workspace or any vertical: a rental company and a tourist guide see
// the SAME wizard, and registering a vehicle grants neither of them anything else. The copy on this
// screen is deliberately vertical-neutral (it never mentions rental).

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ uploadError?: string }> };

export default async function NewVehiclePage({ searchParams }: Props) {
  const { uploadError } = await searchParams;
  const locale = await getLocale();
  const t = await getServerTranslator("provider");

  const access = await resolveVehicleCreateAccess();
  if (!access.ok) {
    if (access.reason === "UNAUTHENTICATED") {
      redirect({ href: "/login", locale });
      return null;
    }
    notFound(); // a provider without vehicle-create authority never sees a creation surface
  }

  const uploadErrorMessage = uploadError
    ? isAssetDocumentErrorCode(uploadError)
      ? t(getAssetDocumentErrorTranslationKey(uploadError))
      : isOnboardingRequestErrorCode(uploadError)
        ? t(getOnboardingRequestErrorTranslationKey(uploadError))
        : t("vehicleOnboardUploadFailed")
    : null;
  const keyScope = createHash("sha256").update(`barq:vehicle-onboarding:${access.providerId}`).digest("hex").slice(0, 32);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-32 pt-6 sm:px-6 sm:pt-8">
      <Link href="/provider/vehicles" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t("addVehicleButton")}</h1>
        <p className="text-sm text-foreground/70">{t("vehicleOnboardUploadSubtitle")}</p>
      </div>

      {uploadErrorMessage && <Alert variant="danger">{uploadErrorMessage}</Alert>}

      <Card hoverLift={false}>
        {/* The server records every request key durably (per provider), so repeated submissions with
            one key create only one setup. The rendered key is the no-JavaScript fallback; the
            hydrated form keeps ONE key per attempt in the tab's session storage, scoped to this
            provider by an opaque tag (a hash — the provider id itself is not sent to the browser). */}
        <RegistrationUploadForm action="/api/provider/vehicles/onboarding/upload" locale={locale} requestKey={randomUUID()} keyScope={keyScope} cancelHref="/provider/vehicles" ocrAvailable={isRegistrationOcrOperational()} />
      </Card>
    </div>
  );
}
