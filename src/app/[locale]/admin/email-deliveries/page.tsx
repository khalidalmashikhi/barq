import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect, getPathname } from "@/i18n/navigation";
import { MailWarning } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getBookingEmailDeliveries } from "@/lib/admin/get-booking-email-deliveries";
import { getBookingEmailProvider } from "@/lib/notifications/email/booking-email-config";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import type { EmailDeliveryStatus } from "@prisma/client";

// BOOKING OPS OBSERVABILITY — the read-only admin surface for the BookingEmailDelivery outbox.
// A single list answers every operational question (enqueued? which event? status? attempts? last
// attempt/sent? why failed? which booking?) — no separate detail route (§18). requireAdmin()-gated
// (via the query). No email body/address/secret is stored on a row, so none can leak. No mutation:
// no manual resend/unlock in this gate.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUSES: EmailDeliveryStatus[] = ["PENDING", "PROCESSING", "SENT", "FAILED", "SKIPPED"];

const STATUS_BADGE: Record<EmailDeliveryStatus, BadgeVariant> = {
  PENDING: "warning",
  PROCESSING: "info",
  SENT: "success",
  FAILED: "danger",
  SKIPPED: "default",
};

const STATUS_LABEL_KEY = {
  PENDING: "emailDeliveryStatusPending",
  PROCESSING: "emailDeliveryStatusProcessing",
  SENT: "emailDeliveryStatusSent",
  FAILED: "emailDeliveryStatusFailed",
  SKIPPED: "emailDeliveryStatusSkipped",
} as const satisfies Record<EmailDeliveryStatus, string>;

type SearchParams = { status?: string; page?: string };

export default async function AdminEmailDeliveriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const status = STATUSES.includes(params.status as EmailDeliveryStatus) ? (params.status as EmailDeliveryStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getBookingEmailDeliveries({ status, page });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  // Provider state (§22) — infrastructure exists vs. live sending enabled. Never exposes credentials.
  const providerKind = getBookingEmailProvider().kind;
  const providerLabelKey =
    providerKind === "resend"
      ? "emailDeliveryProviderResend"
      : providerKind === "console"
        ? "emailDeliveryProviderConsole"
        : "emailDeliveryProviderDisabled";
  const providerVariant: BadgeVariant = providerKind === "disabled" ? "warning" : "success";

  const basePath = getPathname({ href: "/admin/email-deliveries", locale });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("emailDeliveriesTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("emailDeliveriesDescription")}</p>
      </div>

      {/* Provider state — outbox infrastructure vs. live sending. Disabled = nothing is sent, but
          outbox rows are still enqueued (honest, never implies email is live). */}
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-foreground/60">{t("emailDeliveryProviderLabel")}</span>
          <Badge variant={providerVariant}>{t(providerLabelKey)}</Badge>
        </div>
        {providerKind === "disabled" && <p className="text-xs text-foreground/50">{t("emailDeliveryProviderNote")}</p>}
        <p className="text-xs text-foreground/40">{t("emailDeliverySentNote")}</p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">{t("emailDeliveryStatusAllLabel")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL_KEY[s])}
            </option>
          ))}
        </select>
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("emailDeliveryFilterApplyButton")}
        </button>
      </form>

      {result.totalCount === 0 && !status ? (
        <EmptyState icon={MailWarning} message={t("emailDeliveryNoneLabel")} description={t("emailDeliveryNoneDescription")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={MailWarning} message={t("emailDeliveryNoResultsLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((row) => (
            <div key={row.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_BADGE[row.status]}>{t(STATUS_LABEL_KEY[row.status])}</Badge>
                  {row.stale && <Badge variant="danger">{t("emailDeliveryStaleLabel")}</Badge>}
                  <span className="text-sm font-medium text-foreground">{row.kind}</span>
                </div>
                <span className="text-xs text-foreground/40">
                  {formatDate(row.createdAt, locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/50">
                <span>
                  {t("emailDeliveryAttemptsLabel")}: <span className="font-medium text-foreground/70">{row.attemptCount}</span>
                </span>
                {row.lastAttemptAt && (
                  <span>
                    {t("emailDeliveryLastAttemptLabel")}:{" "}
                    <span className="font-medium text-foreground/70">
                      {formatDate(row.lastAttemptAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                )}
                {row.sentAt && (
                  <span>
                    {t("emailDeliverySentAtLabel")}:{" "}
                    <span className="font-medium text-foreground/70">
                      {formatDate(row.sentAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                )}
                {row.lastError && (
                  <span>
                    {t("emailDeliveryErrorLabel")}: <span dir="ltr" className="font-mono font-medium text-danger">{row.lastError}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/40">
                <span dir="ltr">{t("emailDeliveryRecipientLabel")}: {row.recipientUserId}</span>
                <Link href={`/admin/bookings/${row.bookingId}`} className="text-foreground/60 hover:text-foreground hover:underline">
                  {t("emailDeliveryViewBookingLabel")}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={basePath} />
    </div>
  );
}
