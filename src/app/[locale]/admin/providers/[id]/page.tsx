import type { Metadata } from "next";
import type { ProviderType } from "@prisma/client";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Edit, Eye, Compass, ClipboardList, FileCheck2, Check, X } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderDetail } from "@/lib/admin/get-provider-detail";
import { approveProvider } from "@/lib/admin/approve-provider";
import { rejectProvider } from "@/lib/admin/reject-provider";
import { archiveProvider } from "@/lib/admin/archive-provider";
import { suspendProvider } from "@/lib/admin/suspend-provider";
import { reactivateProvider } from "@/lib/admin/reactivate-provider";
import { publishProvider, unpublishProvider } from "@/lib/admin/toggle-provider-visibility";
import { getProviderStatusBadgeVariant, getProviderStatusTranslationKey } from "@/lib/admin/presentation/provider-status";
import { isProviderAdminActionErrorCode, getProviderAdminErrorTranslationKey } from "@/lib/admin/provider-admin-errors";
import { getAuditEventsForEntity, type AuditEventItem } from "@/lib/admin/get-audit-events-for-entity";
import { AuditHistory } from "@/components/admin/audit-history";
import { assertProviderApprovable, type RequiredDocumentBlocker } from "@/lib/provider/documents/assert-provider-approvable";
import {
  listProviderDocumentsForAdmin,
  type AdminProviderDocumentListItem,
} from "@/lib/provider/documents/list-provider-documents-for-admin";
import {
  PROVIDER_DOCUMENT_TYPE_LABEL_KEYS,
  requiredDocumentTypesFor,
  isValidProviderDocumentTypeKey,
} from "@/lib/provider-document-types";
import {
  isProviderDocumentErrorCode,
  getProviderDocumentErrorTranslationKey,
} from "@/lib/provider/documents/provider-document-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Verification-document presentation maps (Gate 3). Same status→badge and
// blocker-reason→message convention as the provider-facing verification page,
// kept local to this admin surface (no shared React component; the checklist
// logic itself is derived server-side by assertProviderApprovable /
// listProviderDocumentsForAdmin, never re-computed in the client).
const DOC_STATUS_BADGE = { PENDING: "info", APPROVED: "success", REJECTED: "danger" } as const;
const DOC_STATUS_LABEL_KEY = {
  PENDING: "documentStatusPending",
  APPROVED: "documentStatusApproved",
  REJECTED: "documentStatusRejected",
} as const;
const BLOCKER_REASON_LABEL_KEY = {
  MISSING: "documentBlockerMissing",
  NOT_APPROVED: "documentBlockerNotApproved",
} as const;

function formatDocumentBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Provider detail — Phase 2.2 (Provider Admin UI). Mirrors
// admin/categories/[id]/page.tsx's shape: status/visibility control
// lives here (needs more room than a list row), the list row keeps
// single-click quick actions. No nested child entity here (unlike
// Category's SubCategory), so this page is a straightforward detail +
// action panel, not a parent/children layout.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; docError?: string; docNotice?: string }>;
};

export default async function ProviderDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, docError, docNotice } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let provider;
  try {
    provider = await getProviderDetail(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  if (!provider) {
    notFound();
  }

  const errorMessage = error && isProviderAdminActionErrorCode(error) ? t(getProviderAdminErrorTranslationKey(error)) : null;
  const docErrorMessage =
    docError && isProviderDocumentErrorCode(docError) ? t(getProviderDocumentErrorTranslationKey(docError)) : null;
  const isPending = provider.status === "APPLIED" || provider.status === "UNDER_REVIEW";

  let auditEvents: AuditEventItem[] = [];
  try {
    auditEvents = await getAuditEventsForEntity("Provider", id);
  } catch {
    auditEvents = [];
  }

  // Verification documents (Gate 3) — one admin-side read of this provider's
  // documents plus the proactive approval blockers. Both are best-effort: if the
  // storage-backed read or the blocker check fails, the rest of the admin page
  // (status control, related links, audit) must still render. `documents` is the
  // raw list; `blockers` drives the approval-gate panel and disables Approve.
  let documents: AdminProviderDocumentListItem[] = [];
  try {
    documents = await listProviderDocumentsForAdmin(id);
  } catch {
    documents = [];
  }
  let blockers: RequiredDocumentBlocker[] = [];
  try {
    blockers = await assertProviderApprovable(id);
  } catch {
    blockers = [];
  }
  const hasBlockers = blockers.length > 0;
  // getProviderDetail types providerType as a plain string; the DB value is
  // always a valid ProviderType enum member. Cast narrowly here so the pure
  // requirement helper (keyed by ProviderType) type-checks.
  const requiredTypes = new Set<string>(
    requiredDocumentTypesFor({ providerType: provider.providerType as ProviderType })
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/providers" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToProvidersLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{provider.businessName.en}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">{provider.slug ? `/${provider.slug}` : t("noSlugLabel")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getProviderStatusBadgeVariant(provider.status)}>{t(getProviderStatusTranslationKey(provider.status))}</Badge>
          <Badge variant={provider.visible ? "success" : "default"}>
            {provider.visible ? t("providerVisibleLabel") : t("providerHiddenLabel")}
          </Badge>
          {/* See the provider's customer-facing storefront before approving —
              Unified Preview System. New tab. */}
          <Link
            href={`/admin/providers/${id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Eye size={14} strokeWidth={1.75} />
            {t("previewProfileButton")}
          </Link>
          <Link
            href={`/admin/providers/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Edit size={14} strokeWidth={1.75} />
            {t("editProviderButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {docNotice && <Alert variant="success">{t("documentReviewSaved")}</Alert>}
      {docErrorMessage && <Alert variant="danger">{docErrorMessage}</Alert>}

      {provider.status === "REJECTED" && provider.rejectionReason && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-danger">{t("providerRejectionReasonLabel")}</h2>
          {provider.rejectedAt && (
            <p className="mt-1 text-xs text-foreground/40">
              {formatDate(provider.rejectedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{provider.rejectionReason}</p>
        </Card>
      )}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("providerDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("providerNameArLabel")}</dt>
            <dd className="text-sm text-foreground" dir="rtl">{provider.businessName.ar}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerNameEnLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.businessName.en}</dd>
          </div>
          {provider.businessDescription && (
            <>
              <div>
                <dt className="text-xs text-foreground/40">{t("providerDescriptionArLabel")}</dt>
                <dd className="text-sm text-foreground" dir="rtl">{provider.businessDescription.ar || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground/40">{t("providerDescriptionEnLabel")}</dt>
                <dd className="text-sm text-foreground">{provider.businessDescription.en || "—"}</dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("providerTypeLabel")}</dt>
            <dd className="text-sm text-foreground">
              {provider.providerType === "INDIVIDUAL" ? t("providerTypeIndividual") : t("providerTypeCompany")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerContactEmailLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.contactEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerCityLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.city || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerLogoUrlLabel")}</dt>
            <dd className="truncate text-sm text-foreground">{provider.logoUrl || "—"}</dd>
          </div>
          {provider.approvedAt && (
            <div>
              <dt className="text-xs text-foreground/40">{t("providerApprovedAtLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(provider.approvedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("providerCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(provider.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("providerActionsTitle")}</h2>

        {/* Approval blocker panel (Gate 3) — shown proactively for a pending
            application whose required verification documents are missing or not
            yet APPROVED. The server-side gate in approveProvider() is the real
            enforcement; this panel + the disabled Approve button below are the
            visible reflection of it, so an admin knows WHY approval is blocked. */}
        {isPending && hasBlockers && (
          <Alert variant="warning" title={t("approvalBlockedTitle")} className="mt-3">
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {blockers.map((blocker) => (
                <li key={blocker.type}>
                  {/* blocker.type is a policy key (ADR-0017) — may be an admin-created
                      key outside the code registry, so guard the label like the
                      document list below: registry label if known, else the key. */}
                  <span className="font-medium">
                    {isValidProviderDocumentTypeKey(blocker.type)
                      ? t(PROVIDER_DOCUMENT_TYPE_LABEL_KEYS[blocker.type])
                      : blocker.type}
                  </span>
                  {" — "}
                  {t(BLOCKER_REASON_LABEL_KEY[blocker.reason])}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="mt-3 flex flex-wrap gap-3">
          {isPending && !hasBlockers && (
            <form
              action={async () => {
                "use server";
                const result = await approveProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {t("approveButton")}
              </SubmitButton>
            </form>
          )}

          {/* Blockers present → Approve is unavailable (disabled, non-submitting).
              The panel above states the reasons. */}
          {isPending && hasBlockers && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={t("approveDisabledDocumentsHint")}
              className="cursor-not-allowed rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground opacity-50"
            >
              {t("approveButton")}
            </button>
          )}

          <form
            action={async () => {
              "use server";
              const result = provider.visible ? await unpublishProvider(id) : await publishProvider(id);
              if (!result.ok) {
                redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                return;
              }
              redirect({ href: `/admin/providers/${id}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
              {provider.visible ? t("unpublishProviderButton") : t("publishProviderButton")}
            </SubmitButton>
          </form>

          {provider.status !== "DEACTIVATED" && (
            <form
              action={async () => {
                "use server";
                const result = await archiveProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("archiveProviderButton")}
              </SubmitButton>
            </form>
          )}

          {/* Suspend / reactivate — the SAME tested, transition-guarded server
              actions used under /admin/users, surfaced here so an admin need not
              leave the provider detail page. Each renders only for the status it
              is valid from (APPROVED → suspend, SUSPENDED → reactivate). */}
          {provider.status === "APPROVED" && (
            <form
              action={async () => {
                "use server";
                const result = await suspendProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("suspendProviderButton")}
              </SubmitButton>
            </form>
          )}

          {provider.status === "SUSPENDED" && (
            <form
              action={async () => {
                "use server";
                const result = await reactivateProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {t("reactivateProviderButton")}
              </SubmitButton>
            </form>
          )}
        </div>

        {/* Reject — only for a pending application (APPLIED/UNDER_REVIEW). A
            mandatory reason (validated server-side too) transitions the provider
            to REJECTED; the applicant can then correct and resubmit. Not shown
            for REJECTED — the applicant must resubmit back to APPLIED before a
            fresh review cycle. */}
        {isPending && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const reason = formData.get("reason");
              const result = await rejectProvider(id, typeof reason === "string" ? reason : "");
              if (!result.ok) {
                redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                return;
              }
              redirect({ href: `/admin/providers/${id}`, locale });
            }}
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          >
            <label htmlFor="reject-reason" className="text-xs font-medium text-foreground/50">
              {t("rejectReasonLabel")}
            </label>
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
        )}
      </Card>

      {/* Verification Documents (Gate 3) — the admin review surface. Not a
          separate subsystem: it reads via listProviderDocumentsForAdmin (Gate 2)
          and each action posts to the Gate-2 admin review route. Admin acts on an
          opaque versionToken (never the objectKey); a STALE_DOCUMENT result from a
          concurrent change surfaces as documentErrorStaleDocument (reload). A
          document rejection here does NOT reject the whole provider. */}
      <Card hoverLift={false}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileCheck2 size={16} strokeWidth={1.75} />
          {t("verificationDocumentsTitle")}
        </h2>

        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/50">{t("noDocumentsUploaded")}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {documents.map((doc) => {
              const typeLabel = isValidProviderDocumentTypeKey(doc.type)
                ? t(PROVIDER_DOCUMENT_TYPE_LABEL_KEYS[doc.type])
                : doc.type;
              const isRequired = requiredTypes.has(doc.type);
              return (
                <div key={doc.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{typeLabel}</span>
                    <Badge variant={isRequired ? "default" : "info"}>
                      {isRequired ? t("documentRequiredLabel") : t("documentOptionalLabel")}
                    </Badge>
                    <Badge variant={DOC_STATUS_BADGE[doc.status]}>{t(DOC_STATUS_LABEL_KEY[doc.status])}</Badge>
                  </div>

                  <p className="mt-2 text-sm text-foreground/70">
                    {doc.originalFilename}{" "}
                    <span className="text-foreground/40">
                      · {doc.mimeType} · {formatDocumentBytes(doc.sizeBytes)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-foreground/40">
                    {t("documentUploadedAtLabel")}:{" "}
                    {formatDate(doc.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                    {doc.reviewedAt && (
                      <>
                        {" · "}
                        {t("documentReviewedAtLabel")}:{" "}
                        {formatDate(doc.reviewedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                      </>
                    )}
                  </p>

                  {doc.status === "REJECTED" && doc.rejectionReason && (
                    <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                      <span className="text-xs font-medium text-danger">{t("documentRejectionReasonLabel")}</span>
                      <p className="whitespace-pre-wrap text-sm text-foreground/80">{doc.rejectionReason}</p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <a
                      href={`/api/provider/documents/${doc.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                    >
                      <Eye size={14} strokeWidth={1.75} />
                      {t("documentViewButton")}
                    </a>

                    {doc.status !== "APPROVED" && (
                      <form action={`/api/admin/provider-documents/${doc.id}/review`} method="post">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="providerId" value={id} />
                        <input type="hidden" name="versionToken" value={doc.versionToken} />
                        <input type="hidden" name="decision" value="APPROVE" />
                        <SubmitButton className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                          <Check size={14} strokeWidth={1.75} />
                          {t("documentApproveButton")}
                        </SubmitButton>
                      </form>
                    )}
                  </div>

                  {doc.status !== "REJECTED" && (
                    <form
                      action={`/api/admin/provider-documents/${doc.id}/review`}
                      method="post"
                      className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="providerId" value={id} />
                      <input type="hidden" name="versionToken" value={doc.versionToken} />
                      <input type="hidden" name="decision" value="REJECT" />
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
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("relatedTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/admin/services?providerId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Compass size={14} strokeWidth={1.75} />
            {t("viewProviderServicesLabel")}
          </Link>
          <Link
            href={`/admin/bookings?providerId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <ClipboardList size={14} strokeWidth={1.75} />
            {t("viewProviderBookingsLabel")}
          </Link>
        </div>
      </Card>

      <AuditHistory events={auditEvents} title={t("um_auditHistoryTitle")} emptyLabel={t("um_auditNoEvents")} actorLabel={t("um_auditActorLabel")} locale={locale} />
    </div>
  );
}
