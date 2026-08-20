import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Pencil } from "lucide-react";
import { getProviderVehicle } from "@/lib/vehicles/queries/get-provider-vehicle";
import { getVehicleStatusBadgeVariant, getVehicleStatusTranslationKey } from "@/lib/vehicles/presentation/vehicle-status";
import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { VehicleVerificationSection } from "@/components/provider/vehicle-verification-section";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Vehicle detail — provider owner view. getProviderVehicle() is ownership-scoped
// (foreign/missing/invalid → null → notFound, never enumerable). Shows the private
// vehicle fields + operational status (DISPLAY-ONLY, no activate/deactivate/
// maintenance/delete — that lifecycle stays admin/system-owned) + an Edit link.
// VEHICLE-LC2 adds the VERIFICATION section (a SEPARATE axis): the provider uploads
// required private documents and submits the vehicle for BARQ review. That section
// never approves or activates the vehicle and never exposes a document publicly.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const DOC_NOTICE_KEYS: Record<string, "vehicleDocNoticeUploaded" | "vehicleDocNoticeReplaced" | "vehicleDocNoticeDeleted"> = {
  uploaded: "vehicleDocNoticeUploaded",
  replaced: "vehicleDocNoticeReplaced",
  deleted: "vehicleDocNoticeDeleted",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const vehicle = await getProviderVehicle(id);
  if (!vehicle) {
    notFound();
  }

  const verification = await getVehicleVerificationData(id);

  // Post-redirect feedback (?docNotice/?verifyNotice = success; ?docError/?verifyError = domain code).
  const docNotice = first(sp.docNotice);
  const noticeKey = docNotice ? DOC_NOTICE_KEYS[docNotice] : first(sp.verifyNotice) === "submitted" ? "vehicleVerifyNoticeSubmitted" : undefined;
  const rawError = first(sp.docError) ?? first(sp.verifyError);
  const errorKey = rawError && isAssetDocumentErrorCode(rawError) ? getAssetDocumentErrorTranslationKey(rawError) : undefined;

  const title = buildVehicleTitle(vehicle.make, vehicle.model) ?? t("vehicleUntitled");
  const typeLabel = vehicle.vehicleType
    ? vehicleTypeOptions(locale).find((o) => o.code === vehicle.vehicleType)?.label ?? vehicle.vehicleType
    : null;

  const rows: { label: string; value: string | null }[] = [
    { label: t("vehicleMakeLabel"), value: vehicle.make },
    { label: t("vehicleModelLabel"), value: vehicle.model },
    { label: t("vehicleModelYearLabel"), value: vehicle.modelYear ? String(vehicle.modelYear) : null },
    { label: t("vehicleColorLabel"), value: vehicle.color },
    { label: t("vehicleTypeLabel"), value: typeLabel },
    { label: t("vehiclePassengerCapacityLabel"), value: vehicle.passengerCapacity ? String(vehicle.passengerCapacity) : null },
    { label: t("vehicleRegistrationLabel"), value: vehicle.registrationNumber },
    { label: t("vehiclePublicDescriptionLabel"), value: vehicle.publicDescription },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/vehicles"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <Badge variant={getVehicleStatusBadgeVariant(vehicle.status)}>{t(getVehicleStatusTranslationKey(vehicle.status))}</Badge>
        </div>
        <Link
          href={`/provider/vehicles/${vehicle.id}/edit`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Pencil size={15} strokeWidth={1.75} aria-hidden />
          {t("editVehicleButton")}
        </Link>
      </div>

      {noticeKey && <Alert variant="success">{t(noticeKey)}</Alert>}
      {errorKey && <Alert variant="danger">{t(errorKey)}</Alert>}

      <Card hoverLift={false}>
        <dl className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <dt className="text-xs font-medium uppercase tracking-wide text-foreground/40">{row.label}</dt>
              <dd className="text-sm text-foreground sm:text-end">{row.value ?? "—"}</dd>
            </div>
          ))}
          <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <dt className="text-xs font-medium uppercase tracking-wide text-foreground/40">{t("vehicleStatusLabel")}</dt>
            <dd className="sm:text-end">
              <Badge variant={getVehicleStatusBadgeVariant(vehicle.status)}>{t(getVehicleStatusTranslationKey(vehicle.status))}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      {verification && <VehicleVerificationSection vehicleId={vehicle.id} locale={locale} data={verification} />}
    </div>
  );
}
