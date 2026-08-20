import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  getVehicleVerificationBadgeVariant,
  getVehicleVerificationTranslationKey,
  getVehicleDocStatusBadgeVariant,
  getVehicleDocStatusTranslationKey,
} from "@/lib/vehicles/presentation/vehicle-verification-status";
import type { VehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { formatDate } from "@/lib/i18n/format-date";
import type { Locale } from "@/i18n/locales";

// VEHICLE-LC2 — provider-facing Verification section on the vehicle detail page.
// Pure presentation over the ownership-scoped read model (getVehicleVerificationData):
// verification status (SEPARATE axis from operational status), the required-document
// checklist, and per-item upload/replace/view/delete + a submit control. Every
// mutation is a native <form> POST to an /api route (multipart bypasses the 1 MB
// server-action body cap); the document is surfaced by id + status only — never an
// objectKey, and viewing mints a fresh 60s signed URL server-side.

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export async function VehicleVerificationSection({
  vehicleId,
  locale,
  data,
}: {
  vehicleId: string;
  locale: string;
  data: VehicleVerificationData;
}) {
  const t = await getTranslations("provider");
  const base = `/api/provider/vehicles/${vehicleId}`;
  const showReason =
    data.verificationReason && (data.verificationStatus === "CHANGES_REQUESTED" || data.verificationStatus === "REJECTED");
  // VEHICLE-LC4 — a required document past its expiry makes the vehicle not
  // customer-eligible (computed, not a status change).
  const hasExpiredDoc = data.items.some((item) => item.isExpired);

  return (
    <Card hoverLift={false}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("vehicleVerificationTitle")}</h2>
          <Badge variant={getVehicleVerificationBadgeVariant(data.verificationStatus)}>
            {t(getVehicleVerificationTranslationKey(data.verificationStatus))}
          </Badge>
        </div>

        {showReason && (
          <Alert variant={data.verificationStatus === "REJECTED" ? "danger" : "warning"} title={t("vehicleVerificationReasonLabel")}>
            {data.verificationReason}
          </Alert>
        )}

        {hasExpiredDoc && <Alert variant="danger">{t("vehicleNotEligibleExpiredNote")}</Alert>}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/40">{t("vehicleRequiredDocumentsTitle")}</h3>
          <ul className="flex flex-col divide-y divide-border">
            {data.items.map((item) => (
              <li key={item.type} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t(item.labelKey)}</span>
                  <Badge variant={item.status ? getVehicleDocStatusBadgeVariant(item.status) : "default"}>
                    {t(getVehicleDocStatusTranslationKey(item.status))}
                  </Badge>
                </div>

                {item.status === "REJECTED" && item.rejectionReason && (
                  <p className="text-xs text-danger">
                    <span className="font-medium">{t("vehicleDocRejectionReasonLabel")}:</span> {item.rejectionReason}
                  </p>
                )}

                {/* VEHICLE-LC4 — expiry is derived (never a stored status). Show the
                    expiry date, and flag an expired document (which blocks the vehicle
                    from being customer-eligible until the document is valid again). */}
                {item.expiresAt && (
                  <p className={`text-xs ${item.isExpired ? "text-danger" : "text-foreground/50"}`}>
                    <span className="font-medium">{t("vehicleDocExpiresLabel")}:</span>{" "}
                    {formatDate(item.expiresAt, locale as Locale, { day: "numeric", month: "long", year: "numeric" })}
                    {item.isExpired && <> · {t("vehicleDocExpiredWarning")}</>}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {item.canView && item.documentId && (
                    <a
                      href={`${base}/documents/${item.documentId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-9 items-center rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/5"
                    >
                      {t("vehicleDocViewButton")}
                    </a>
                  )}

                  {item.canUpload && (
                    <form action={`${base}/documents`} method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="type" value={item.type} />
                      <input
                        type="file"
                        name="file"
                        accept={ACCEPT}
                        required
                        aria-label={t("vehicleDocUploadButton")}
                        className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-foreground/5 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                      />
                      <button
                        type="submit"
                        className="inline-flex min-h-9 items-center rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                      >
                        {t("vehicleDocUploadButton")}
                      </button>
                    </form>
                  )}

                  {item.canReplace && item.documentId && (
                    <form
                      action={`${base}/documents/${item.documentId}/replace`}
                      method="post"
                      encType="multipart/form-data"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input
                        type="file"
                        name="file"
                        accept={ACCEPT}
                        required
                        aria-label={t("vehicleDocReplaceButton")}
                        className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-foreground/5 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                      />
                      <button
                        type="submit"
                        className="inline-flex min-h-9 items-center rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/5"
                      >
                        {t("vehicleDocReplaceButton")}
                      </button>
                    </form>
                  )}

                  {item.canDelete && item.documentId && (
                    <form action={`${base}/documents/${item.documentId}/delete`} method="post">
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        className="inline-flex min-h-9 items-center rounded-full border border-danger/30 px-4 py-1.5 text-xs font-medium text-danger hover:bg-danger/5"
                      >
                        {t("vehicleDocDeleteButton")}
                      </button>
                    </form>
                  )}
                </div>

                {item.canUpload && <p className="text-[11px] text-foreground/40">{t("vehicleDocFileHint")}</p>}
              </li>
            ))}
          </ul>
        </div>

        {data.editable && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {!data.submittable && <p className="text-xs text-foreground/50">{t("vehicleSubmitBlockedHint")}</p>}
            <form action={`${base}/verification/submit`} method="post" className="flex">
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                disabled={!data.submittable}
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("vehicleSubmitVerificationButton")}
              </button>
            </form>
          </div>
        )}
      </div>
    </Card>
  );
}
