import type { Metadata } from "next";
import { ArrowRight, FileCheck2, AlertTriangle, Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { UnauthenticatedError } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { getProviderVerificationData } from "@/lib/provider/documents/get-provider-verification-data";
import { PROVIDER_DOCUMENT_TYPE_LABEL_KEYS, isValidProviderDocumentTypeKey } from "@/lib/provider-document-types";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import {
  isProviderDocumentErrorCode,
  getProviderDocumentErrorTranslationKey,
} from "@/lib/provider/documents/provider-document-errors";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { VerificationDocumentControl } from "@/components/provider/verification/verification-document-control";
import { formatFileSize } from "@/lib/provider/documents/upload-ui";

// Provider Verification & Documents (Gate 3) — the provider-facing DOCUMENT
// surface. Lives under /provider/* so requireProvider() (via the layout) gates
// it: APPLIED/UNDER_REVIEW/REJECTED/APPROVED reach it; SUSPENDED/DEACTIVATED get
// the layout's notFound(). Owns documents ONLY — profile fields live in Settings.
// All checklist logic is derived server-side in getProviderVerificationData();
// this page only renders. Uploads use the Gate-2 authenticated route handlers
// (progressive <form> POST, no client JS); the server remains authoritative.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STATUS_BADGE = { PENDING: "info", APPROVED: "success", REJECTED: "danger" } as const;
const STATUS_LABEL_KEY = {
  PENDING: "documentStatusPending",
  APPROVED: "documentStatusApproved",
  REJECTED: "documentStatusRejected",
} as const;

type Props = {
  searchParams: Promise<{ docError?: string; docNotice?: string; vNotice?: string; vError?: string }>;
};

export default async function ProviderVerificationPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { docError, docNotice, vNotice, vError } = await searchParams;
  const t = await getServerTranslator("provider");

  let data;
  try {
    data = await getProviderVerificationData();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  const errorMessage =
    docError && isProviderDocumentErrorCode(docError) ? t(getProviderDocumentErrorTranslationKey(docError)) : null;
  const submitErrorMessage =
    vError === "NOT_READY"
      ? t("verificationSubmitNotReady")
      : vError === "INVALID_STATE"
        ? t("verificationSubmitInvalidState")
        : vError === "NO_PROVIDER_PROFILE"
          ? t("documentErrorNoProviderProfile")
          : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <FileCheck2 size={22} strokeWidth={1.75} />
          {t("verificationTitle")}
        </h1>
        <p className="text-sm text-foreground/60">{t("verificationIntro")}</p>
        <p className="text-xs text-foreground/40">
          {t("verificationReadiness", { approved: data.requiredApproved, total: data.requiredTotal })}
        </p>
      </div>

      {docNotice && <Alert variant="success">{t("documentNoticeSaved")}</Alert>}
      {vNotice === "submitted" && <Alert variant="success">{t("verificationSubmitNotice")}</Alert>}
      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {submitErrorMessage && <Alert variant="danger">{submitErrorMessage}</Alert>}

      {data.providerStatus === "UNDER_REVIEW" && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <FileCheck2 size={15} strokeWidth={1.75} />
            {t("verificationUnderReviewNote")}
          </span>
        </Alert>
      )}

      {data.providerStatus === "REJECTED" && (
        <Alert variant="warning">
          {t("verificationRejectedNote")}{" "}
          <Link href="/provider-application" className="font-medium underline underline-offset-2">
            {t("verificationGoToApplicationLink")}
          </Link>
        </Alert>
      )}

      {!data.storageAvailable && (
        <Alert variant="warning">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} strokeWidth={1.75} />
            {t("documentStorageUnavailable")}
          </span>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        {data.items.map((item) => {
          // ADR-0017: render the admin-configured bilingual name; fall back to the
          // code registry i18n label (or the raw key) if the DB name is empty.
          const label =
            extractLocalizedText(item.name, locale) ||
            (isValidProviderDocumentTypeKey(item.type) ? t(PROVIDER_DOCUMENT_TYPE_LABEL_KEYS[item.type]) : item.type);
          const description = extractLocalizedText(item.description, locale);
          const doc = item.document;
          return (
            <Card key={item.type} hoverLift={false}>
              <div className="flex flex-col gap-3 p-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <Badge variant={item.required ? "default" : "info"}>
                    {item.required ? t("documentRequiredLabel") : t("documentOptionalLabel")}
                  </Badge>
                  {doc && <Badge variant={STATUS_BADGE[doc.status]}>{t(STATUS_LABEL_KEY[doc.status])}</Badge>}
                </div>
                {description && <p className="text-xs text-foreground/50">{description}</p>}
                {item.required && <p className="text-xs text-foreground/40">{t("documentRequiredHint")}</p>}

                {doc ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-foreground/70">
                      {doc.originalFilename}{" "}
                      <span className="text-foreground/40" dir="ltr">
                        · {formatFileSize(doc.sizeBytes)}
                      </span>
                    </p>
                    {doc.status === "REJECTED" && doc.rejectionReason && (
                      <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                        <span className="text-xs font-medium text-danger">{t("documentRejectionReasonLabel")}</span>
                        <p className="whitespace-pre-wrap text-sm text-foreground/80">{doc.rejectionReason}</p>
                      </div>
                    )}
                    <VerificationDocumentControl
                      locale={locale}
                      type={item.type}
                      doc={{
                        id: doc.id,
                        status: doc.status,
                        originalFilename: doc.originalFilename,
                        sizeBytes: doc.sizeBytes,
                        versionToken: doc.versionToken,
                      }}
                      canDelete={doc.status !== "APPROVED"}
                      storageAvailable={data.storageAvailable}
                      editable={data.editable}
                    />
                  </div>
                ) : data.storageAvailable ? (
                  <VerificationDocumentControl
                    locale={locale}
                    type={item.type}
                    doc={null}
                    canDelete={false}
                    storageAvailable={data.storageAvailable}
                    editable={data.editable}
                  />
                ) : (
                  <p className="text-xs text-foreground/40">{t("documentUploadUnavailableShort")}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Gate 1A — explicit "Submit for verification". Only in DRAFT; disabled
          until every required document is present (uploading is NOT submitting). */}
      {data.editable && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">{t("verificationSubmitTitle")}</h2>
            <p className="text-sm text-foreground/60">{t("verificationSubmitIntro")}</p>
          </div>
          {!data.canSubmit && <p className="text-xs text-foreground/50">{t("verificationSubmitDisabledHint")}</p>}
          <form action="/api/provider/verification/submit" method="post">
            <input type="hidden" name="locale" value={locale} />
            <SubmitButton
              disabled={!data.canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Send size={16} strokeWidth={1.75} className="rtl:-scale-x-100" />
              {t("verificationSubmitButton")}
            </SubmitButton>
          </form>
        </div>
      )}

      <Link
        href="/provider-application"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        {t("verificationBackToApplication")}
        <ArrowRight size={15} strokeWidth={1.75} className="rtl:-scale-x-100" />
      </Link>
    </div>
  );
}
