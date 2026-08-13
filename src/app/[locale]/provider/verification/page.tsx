import type { Metadata } from "next";
import { ArrowRight, FileCheck2, Upload, RefreshCw, Trash2, Eye, AlertTriangle } from "lucide-react";
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

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_BADGE = { PENDING: "info", APPROVED: "success", REJECTED: "danger" } as const;
const STATUS_LABEL_KEY = {
  PENDING: "documentStatusPending",
  APPROVED: "documentStatusApproved",
  REJECTED: "documentStatusRejected",
} as const;

type Props = { searchParams: Promise<{ docError?: string; docNotice?: string }> };

export default async function ProviderVerificationPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { docError, docNotice } = await searchParams;
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
      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

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
                      {doc.originalFilename} <span className="text-foreground/40">· {formatBytes(doc.sizeBytes)}</span>
                    </p>
                    {doc.status === "REJECTED" && doc.rejectionReason && (
                      <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                        <span className="text-xs font-medium text-danger">{t("documentRejectionReasonLabel")}</span>
                        <p className="whitespace-pre-wrap text-sm text-foreground/80">{doc.rejectionReason}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={`/api/provider/documents/${doc.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                      >
                        <Eye size={14} strokeWidth={1.75} />
                        {t("documentViewButton")}
                      </a>

                      {data.storageAvailable && (
                        <form
                          action={`/api/provider/documents/${doc.id}/replace`}
                          method="post"
                          encType="multipart/form-data"
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="versionToken" value={doc.versionToken} />
                          <input
                            type="file"
                            name="file"
                            required
                            accept={ACCEPT}
                            className="max-w-[180px] text-xs text-foreground/60 file:mr-2 file:rounded-full file:border-0 file:bg-accent/20 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                          />
                          <SubmitButton className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                            <RefreshCw size={13} strokeWidth={1.75} />
                            {t("documentReplaceButton")}
                          </SubmitButton>
                        </form>
                      )}

                      {doc.status !== "APPROVED" && (
                        <form action={`/api/provider/documents/${doc.id}/delete`} method="post">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="versionToken" value={doc.versionToken} />
                          <SubmitButton className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                            <Trash2 size={13} strokeWidth={1.75} />
                            {t("documentDeleteButton")}
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                ) : data.storageAvailable ? (
                  <form
                    action="/api/provider/documents"
                    method="post"
                    encType="multipart/form-data"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="type" value={item.type} />
                    <input
                      type="file"
                      name="file"
                      required
                      accept={ACCEPT}
                      className="max-w-[200px] text-xs text-foreground/60 file:mr-2 file:rounded-full file:border-0 file:bg-accent/20 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                    />
                    <SubmitButton className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                      <Upload size={14} strokeWidth={1.75} />
                      {t("documentUploadButton")}
                    </SubmitButton>
                    <span className="w-full text-xs text-foreground/40">{t("documentUploadHint")}</span>
                  </form>
                ) : (
                  <p className="text-xs text-foreground/40">{t("documentUploadUnavailableShort")}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

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
