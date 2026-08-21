import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Eye, Check, X, FileCheck2 } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAdminVehicleReview } from "@/lib/vehicles/admin/get-admin-vehicle-review";
import { reviewVehicleDocument } from "@/lib/vehicles/admin/review-vehicle-document";
import {
  approveVehicleVerification,
  rejectVehicleVerification,
  requestVehicleChanges,
} from "@/lib/vehicles/admin/decide-vehicle-verification";
import { activateVehicle } from "@/lib/vehicles/admin/activate-vehicle";
import { verifyVehicleFourByFour } from "@/lib/vehicles/admin/verify-vehicle-four-by-four";
import { isVehicleAdminActionErrorCode, getVehicleAdminErrorTranslationKey } from "@/lib/vehicles/admin/vehicle-admin-errors";
import { getAuditEventsForEntity, type AuditEventItem } from "@/lib/admin/get-audit-events-for-entity";
import { AuditHistory } from "@/components/admin/audit-history";
import { getVehicleStatusBadgeVariant, getVehicleStatusTranslationKey } from "@/lib/vehicles/presentation/vehicle-status";
import { getVehicleVerificationBadgeVariant, getVehicleVerificationTranslationKey } from "@/lib/vehicles/presentation/vehicle-verification-status";
import { ASSET_DOCUMENT_TYPE_LABEL_KEYS, isValidAssetDocumentTypeKey } from "@/lib/vehicles/documents/asset-document-types";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { isValidUuid } from "@/lib/uuid";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// VEHICLE-LC3 / LC7 — Admin vehicle verification REVIEW + operational-activation
// workspace. Review-first: summary → two-axis status → document review (View +
// per-document Approve/Reject) → overall verification decision (Request changes /
// Reject / Approve). VEHICLE-LC7 adds a SEPARATE operational activation: only once
// verification is APPROVED and the vehicle is REGISTERED with activation blockers
// clear does an Activate control appear (REGISTERED → ACTIVE, status-only). Approving
// verification still NEVER auto-activates; there is still NO deactivate/maintenance
// control (no such lifecycle exists yet). `t` is the admin namespace; `tv` reuses the
// provider namespace for the shared vehicle status / field / document-type labels.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const DOC_STATUS_BADGE = { PENDING: "info", APPROVED: "success", REJECTED: "danger" } as const;
const DOC_STATUS_LABEL_KEY = {
  PENDING: "documentStatusPending",
  APPROVED: "documentStatusApproved",
  REJECTED: "documentStatusRejected",
} as const;
const BLOCKER_LABEL_KEY = {
  REQUIRED_DOCUMENT_MISSING: "vehicleBlockerDocMissing",
  REQUIRED_DOCUMENT_NOT_APPROVED: "vehicleBlockerDocNotApproved",
  REQUIRED_DOCUMENT_EXPIRED: "vehicleBlockerDocExpired",
  INVALID_VEHICLE_DATA: "vehicleBlockerInvalidData",
  INVALID_VERIFICATION_STATE: "vehicleBlockerInvalidState",
} as const;
// VEHICLE-LC7 — activation blocker → safe admin label (reuses the shared doc/data keys).
const ACTIVATION_BLOCKER_LABEL_KEY = {
  INVALID_OPERATIONAL_STATE: "vehicleBlockerInvalidOperationalState",
  VERIFICATION_NOT_APPROVED: "vehicleBlockerVerificationNotApproved",
  REQUIRED_DOCUMENT_MISSING: "vehicleBlockerDocMissing",
  REQUIRED_DOCUMENT_NOT_APPROVED: "vehicleBlockerDocNotApproved",
  REQUIRED_DOCUMENT_EXPIRED: "vehicleBlockerDocExpired",
  INVALID_VEHICLE_DATA: "vehicleBlockerInvalidData",
} as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; docError?: string; docNotice?: string; notice?: string }>;
};

export default async function AdminVehicleReviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, docError, docNotice, notice } = await searchParams;
  const t = await getServerTranslator("admin");
  const tv = await getServerTranslator("provider");
  const locale = await getLocale();

  if (!isValidUuid(id)) notFound();

  let review;
  try {
    review = await getAdminVehicleReview(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  if (!review) notFound();

  const errorMessage = error && isVehicleAdminActionErrorCode(error) ? t(getVehicleAdminErrorTranslationKey(error)) : null;
  const docErrorMessage = docError && isVehicleAdminActionErrorCode(docError) ? t(getVehicleAdminErrorTranslationKey(docError)) : null;

  let auditEvents: AuditEventItem[] = [];
  try {
    auditEvents = await getAuditEventsForEntity("Vehicle", id);
  } catch {
    auditEvents = [];
  }

  const isSubmitted = review.verificationStatus === "SUBMITTED";
  // LC5 — an APPROVED vehicle carrying a PENDING required document is a document
  // RE-REVIEW (a renewed/replaced expired doc), NOT a fresh verification. There is no
  // whole-vehicle decision here — the admin reviews just the pending document below.
  const hasRemediationDoc =
    review.verificationStatus === "APPROVED" && review.items.some((i) => i.required && i.document?.status === "PENDING");
  const hasBlockers = review.approvalBlockers.length > 0;
  const approvalReady = isSubmitted && !hasBlockers;
  const title = buildVehicleTitle(review.vehicle?.make ?? null, review.vehicle?.model ?? null) ?? t("vehicleUntitledLabel");
  const showReason =
    (review.verificationStatus === "CHANGES_REQUESTED" || review.verificationStatus === "REJECTED") && review.verificationReason;

  const rows: { label: string; value: string | null }[] = [
    { label: tv("vehicleMakeLabel"), value: review.vehicle?.make ?? null },
    { label: tv("vehicleModelLabel"), value: review.vehicle?.model ?? null },
    { label: tv("vehicleModelYearLabel"), value: review.vehicle?.modelYear ? String(review.vehicle.modelYear) : null },
    { label: tv("vehicleColorLabel"), value: review.vehicle?.color ?? null },
    { label: tv("vehicleTypeLabel"), value: review.vehicle?.vehicleType ?? null },
    { label: tv("vehiclePassengerCapacityLabel"), value: review.vehicle?.passengerCapacity ? String(review.vehicle.passengerCapacity) : null },
    { label: tv("vehicleRegistrationLabel"), value: review.vehicle?.registrationNumber ?? null },
    { label: tv("vehiclePublicDescriptionLabel"), value: review.vehicle?.publicDescription ?? null },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/vehicles" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} className="rtl:rotate-180" />
        {t("backToVehiclesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">
            {extractLocalizedText(review.providerName, locale) || t("unknownProviderLabel")}
          </p>
        </div>
        {/* Two SEPARATE axes — never collapsed. */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getVehicleStatusBadgeVariant(review.operationalStatus)}>
            {tv(getVehicleStatusTranslationKey(review.operationalStatus))}
          </Badge>
          <Badge variant={getVehicleVerificationBadgeVariant(review.verificationStatus)}>
            {tv(getVehicleVerificationTranslationKey(review.verificationStatus))}
          </Badge>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {notice && <Alert variant="success">{t("vehicleReviewDecisionSaved")}</Alert>}
      {docNotice && <Alert variant="success">{t("documentReviewSaved")}</Alert>}
      {docErrorMessage && <Alert variant="danger">{docErrorMessage}</Alert>}

      {/* VEHICLE-LC7 — operational activation is a SEPARATE admin decision from
          verification approval. It appears only once verification is APPROVED, and
          only for a REGISTERED vehicle whose activation blockers are clear. It writes
          ONLY Asset.status (REGISTERED → ACTIVE); it never re-approves verification. */}
      {review.verificationStatus === "APPROVED" && review.operationalStatus === "ACTIVE" && (
        <Alert variant="success">{t("vehicleOperationalActiveNote")}</Alert>
      )}

      {review.verificationStatus === "APPROVED" && review.operationalStatus === "REGISTERED" && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground">{t("vehicleActivationTitle")}</h2>
          <Alert variant="info" className="mt-3">{t("vehicleApprovedNotLiveNote")}</Alert>
          {review.activationBlockers.length > 0 ? (
            <Alert variant="warning" title={t("vehicleActivationBlockedTitle")} className="mt-3">
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {review.activationBlockers.map((b, i) => (
                  <li key={`${b.reason}-${b.type}-${i}`}>
                    {b.type && isValidAssetDocumentTypeKey(b.type) ? (
                      <>
                        <span className="font-medium">{tv(ASSET_DOCUMENT_TYPE_LABEL_KEYS[b.type])}</span>
                        {" — "}
                      </>
                    ) : null}
                    {t(ACTIVATION_BLOCKER_LABEL_KEY[b.reason])}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <>
              <Alert variant="success" title={t("vehicleActivationReadyTitle")} className="mt-3" />
              <p className="mt-2 text-xs text-foreground/50">{t("vehicleActivationHint")}</p>
              <form
                action={async () => {
                  "use server";
                  const result = await activateVehicle(id);
                  redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
                }}
                className="mt-3"
              >
                <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  {t("vehicleActivateButton")}
                </SubmitButton>
              </form>
            </>
          )}
        </Card>
      )}

      {hasRemediationDoc && <Alert variant="warning">{t("vehicleRemediationReviewNote")}</Alert>}

      {showReason && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground/70">{t("vehicleVerificationReasonLabel")}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{review.verificationReason}</p>
        </Card>
      )}

      <Card hoverLift={false}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("vehicleInfoTitle")}</h2>
          {review.verificationSubmittedAt && (
            <span className="text-xs text-foreground/40">
              {t("submittedAtLabel")}: {formatDate(review.verificationSubmittedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-foreground/40">{row.label}</dt>
              <dd className="text-sm text-foreground">{row.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Two-axis status panel — makes the operational vs verification distinction
          explicit for the reviewer. */}
      <Card hoverLift={false}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("vehicleOperationalStatusLabel")}</dt>
            <dd className="mt-1">
              <Badge variant={getVehicleStatusBadgeVariant(review.operationalStatus)}>
                {tv(getVehicleStatusTranslationKey(review.operationalStatus))}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("vehicleVerificationStatusLabel")}</dt>
            <dd className="mt-1">
              <Badge variant={getVehicleVerificationBadgeVariant(review.verificationStatus)}>
                {tv(getVehicleVerificationTranslationKey(review.verificationStatus))}
              </Badge>
            </dd>
          </div>
        </div>
      </Card>

      {/* TOUR-VEHICLE-CAP — 4x4 capability review. The provider's declaration is
          advisory; the admin establishes the trusted `fourByFourVerified` used by
          GUIDE_WITH_4X4 eligibility. Never inferred from make/model/vehicleType. */}
      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("vehicleFourByFourReviewTitle")}</h2>
        <p className="mt-2 text-sm text-foreground/70">
          <span className="font-medium">{t("vehicleFourByFourClaimedLabel")}:</span>{" "}
          {review.vehicle?.claimedFourByFour === true
            ? t("vehicleFourByFourClaimYes")
            : review.vehicle?.claimedFourByFour === false
              ? t("vehicleFourByFourClaimNo")
              : t("vehicleFourByFourClaimUnset")}
        </p>
        <p className="mt-0.5 text-sm text-foreground/70">
          <span className="font-medium">{t("vehicleFourByFourTrustedLabel")}:</span>{" "}
          {review.vehicle?.fourByFourVerified === true
            ? t("vehicleFourByFourVerified")
            : review.vehicle?.fourByFourVerified === false
              ? t("vehicleFourByFourNo")
              : t("vehicleFourByFourClaimUnset")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form
            action={async () => {
              "use server";
              const result = await verifyVehicleFourByFour(id, true);
              redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-success/40 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/5 disabled:opacity-50">
              {t("vehicleFourByFourConfirmButton")}
            </SubmitButton>
          </form>
          <form
            action={async () => {
              "use server";
              const result = await verifyVehicleFourByFour(id, false);
              redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
              {t("vehicleFourByFourDenyButton")}
            </SubmitButton>
          </form>
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">{t("vehicleFourByFourReviewHint")}</p>
      </Card>

      {/* Verification documents — REVIEW-FIRST, before the overall decision. */}
      <Card hoverLift={false}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileCheck2 size={16} strokeWidth={1.75} />
          {t("verificationDocumentsTitle")}
        </h2>
        <div className="mt-3 flex flex-col gap-4">
          {review.items.map((item) => {
            const label = item.labelKey ? tv(item.labelKey) : item.type;
            const doc = item.document;
            return (
              <div key={item.type} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <Badge variant={item.required ? "default" : "info"}>
                    {item.required ? t("documentRequiredLabel") : t("documentOptionalLabel")}
                  </Badge>
                  {doc ? (
                    <Badge variant={DOC_STATUS_BADGE[doc.status]}>{t(DOC_STATUS_LABEL_KEY[doc.status])}</Badge>
                  ) : (
                    <Badge variant="warning">{t("documentMissingLabel")}</Badge>
                  )}
                </div>

                {!doc ? (
                  <p className="mt-2 text-sm text-foreground/50">{t("documentNotUploadedYet")}</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-foreground/70">
                      {doc.originalFilename}{" "}
                      <span className="text-foreground/40">· {doc.mimeType} · {formatBytes(doc.sizeBytes)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {t("documentUploadedAtLabel")}: {formatDate(doc.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                      {doc.reviewedAt && (
                        <> · {t("documentReviewedAtLabel")}: {formatDate(doc.reviewedAt, locale, { day: "numeric", month: "long", year: "numeric" })}</>
                      )}
                    </p>

                    {doc.status === "REJECTED" && doc.rejectionReason && (
                      <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                        <span className="text-xs font-medium text-danger">{t("documentRejectionReasonLabel")}</span>
                        <p className="whitespace-pre-wrap text-sm text-foreground/80">{doc.rejectionReason}</p>
                      </div>
                    )}

                    {/* VEHICLE-LC6 — the provider's ADVISORY claimed expiry (never trusted). */}
                    {doc.supportsExpiry && doc.claimedExpiryDate && (
                      <p className="mt-2 text-xs text-foreground/50">
                        <span className="font-medium">{t("documentClaimedExpiryLabel")}:</span> {doc.claimedExpiryDate}
                      </p>
                    )}
                    {doc.supportsExpiry && doc.trustedExpiryDate && (
                      <p className="mt-0.5 text-xs text-foreground/50">
                        <span className="font-medium">{t("documentTrustedExpiryLabel")}:</span> {doc.trustedExpiryDate}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-start gap-3">
                      <a
                        href={`/api/provider/vehicles/${id}/documents/${doc.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                      >
                        <Eye size={14} strokeWidth={1.75} />
                        {t("documentViewButton")}
                      </a>

                      {/* Approve — for an expiring type the admin CONFIRMS the trusted
                          date (prefilled from the claim / any existing trusted value)
                          before approval writes AssetDocument.expiresAt. */}
                      {doc.status === "PENDING" && (
                        <form
                          action={async (formData: FormData) => {
                            "use server";
                            const confirmed = formData.get("confirmedExpiryDate");
                            const result = await reviewVehicleDocument({
                              documentId: doc.id,
                              expectedVersionToken: doc.versionToken,
                              decision: "APPROVE",
                              confirmedExpiryDate: typeof confirmed === "string" ? confirmed : null,
                            });
                            redirect({ href: result.ok ? `/admin/vehicles/${id}?docNotice=1` : `/admin/vehicles/${id}?docError=${result.error}`, locale });
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          {doc.supportsExpiry && (
                            <label className="flex flex-col gap-1 text-xs font-medium text-foreground/50">
                              {t("documentConfirmExpiryLabel")}
                              <input
                                type="date"
                                name="confirmedExpiryDate"
                                defaultValue={doc.trustedExpiryDate ?? doc.claimedExpiryDate ?? ""}
                                className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                              />
                            </label>
                          )}
                          <SubmitButton className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                            <Check size={14} strokeWidth={1.75} />
                            {t("documentApproveButton")}
                          </SubmitButton>
                        </form>
                      )}
                    </div>

                    {doc.status === "PENDING" && doc.supportsExpiry && (
                      <p className="mt-1 text-[11px] text-foreground/40">{t("documentConfirmExpiryHint")}</p>
                    )}

                    {doc.status === "PENDING" && (
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const reason = formData.get("reason");
                          const result = await reviewVehicleDocument({
                            documentId: doc.id,
                            expectedVersionToken: doc.versionToken,
                            decision: "REJECT",
                            reason: typeof reason === "string" ? reason : "",
                          });
                          redirect({ href: result.ok ? `/admin/vehicles/${id}?docNotice=1` : `/admin/vehicles/${id}?docError=${result.error}`, locale });
                        }}
                        className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
                      >
                        <label htmlFor={`reject-doc-${doc.id}`} className="text-xs font-medium text-foreground/50">
                          {t("documentRejectReasonLabel")}
                        </label>
                        <textarea
                          id={`reject-doc-${doc.id}`}
                          name="reason"
                          required
                          rows={2}
                          placeholder={t("documentRejectReasonPlaceholder")}
                          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/20"
                        />
                        <SubmitButton className="inline-flex items-center gap-1.5 self-start rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                          <X size={14} strokeWidth={1.75} />
                          {t("documentRejectButton")}
                        </SubmitButton>
                      </form>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Overall decision — only for a SUBMITTED vehicle. NO Activate control. */}
      {isSubmitted && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground">{t("vehicleReviewDecisionTitle")}</h2>

          {hasBlockers && (
            <Alert variant="warning" title={t("vehicleApprovalBlockedTitle")} className="mt-3">
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {review.approvalBlockers.map((b, i) => (
                  <li key={`${b.reason}-${b.type}-${i}`}>
                    {b.type && isValidAssetDocumentTypeKey(b.type) ? (
                      <>
                        <span className="font-medium">{tv(ASSET_DOCUMENT_TYPE_LABEL_KEYS[b.type])}</span>
                        {" — "}
                      </>
                    ) : null}
                    {t(BLOCKER_LABEL_KEY[b.reason])}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {approvalReady && <Alert variant="success" title={t("vehicleApprovalReadyTitle")} className="mt-3" />}

          <div className="mt-3 flex flex-wrap gap-3">
            {approvalReady && (
              <form
                action={async () => {
                  "use server";
                  const result = await approveVehicleVerification(id);
                  redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
                }}
              >
                <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  {t("vehicleApproveVerificationButton")}
                </SubmitButton>
              </form>
            )}
            {hasBlockers && (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={t("vehicleApprovalBlockedTitle")}
                className="cursor-not-allowed rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground opacity-50"
              >
                {t("vehicleApproveVerificationButton")}
              </button>
            )}
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              const reason = formData.get("reason");
              const result = await requestVehicleChanges(id, typeof reason === "string" ? reason : "");
              redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
            }}
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          >
            <label htmlFor="changes-reason" className="text-xs font-medium text-foreground/50">{t("requestChangesReasonLabel")}</label>
            <textarea
              id="changes-reason"
              name="reason"
              required
              rows={3}
              placeholder={t("requestChangesReasonPlaceholder")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-warning focus:outline-none focus:ring-2 focus:ring-warning/20"
            />
            <SubmitButton className="self-start rounded-full border border-warning/40 px-5 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/5 disabled:opacity-50">
              {t("requestChangesButton")}
            </SubmitButton>
          </form>

          <form
            action={async (formData: FormData) => {
              "use server";
              const reason = formData.get("reason");
              const result = await rejectVehicleVerification(id, typeof reason === "string" ? reason : "");
              redirect({ href: result.ok ? `/admin/vehicles/${id}?notice=1` : `/admin/vehicles/${id}?error=${result.error}`, locale });
            }}
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          >
            <label htmlFor="reject-reason" className="text-xs font-medium text-foreground/50">{t("rejectReasonLabel")}</label>
            <textarea
              id="reject-reason"
              name="reason"
              required
              rows={3}
              placeholder={t("rejectReasonPlaceholder")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-danger focus:outline-none focus:ring-2 focus:ring-danger/20"
            />
            <SubmitButton className="self-start rounded-full border border-danger/30 px-5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
              {t("rejectButton")}
            </SubmitButton>
          </form>
        </Card>
      )}

      <AuditHistory events={auditEvents} title={t("um_auditHistoryTitle")} emptyLabel={t("um_auditNoEvents")} actorLabel={t("um_auditActorLabel")} locale={locale} />
    </div>
  );
}
