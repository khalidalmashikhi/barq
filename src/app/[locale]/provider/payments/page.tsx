import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard, Banknote, Undo2, Clock, XCircle } from "lucide-react";
import { redirect, getPathname, Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderPayments } from "@/lib/payments/get-provider-payments";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/payments/payment-status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import { isValidUuid } from "@/lib/uuid";
import type { PaymentStatus } from "@prisma/client";

// Provider Payments — Payment Experience & Financial Operations phase.
// A single paginated history with explicit status filters + summary
// cards (approved option B) — never a separate section per status,
// avoiding duplicate datasets. `summary` is always unfiltered (see
// get-provider-payments.ts's own comment) so the cards stay stable
// while the list below narrows.
//
// SEPARATE FROM EARNINGS: this reads real Payment records; the
// existing /provider/earnings page reads Booking price snapshots. The
// two are never merged here or there — see that page's own added
// cross-link/explanation card.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STATUSES: PaymentStatus[] = ["INITIATED", "CAPTURED", "REFUNDED_PARTIAL", "REFUNDED_FULL", "FAILED"];

type SearchParams = {
  status?: string;
  bookingId?: string;
  page?: string;
};

export default async function ProviderPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const locale = await getLocale();

  const status = STATUSES.includes(params.status as PaymentStatus) ? (params.status as PaymentStatus) : undefined;
  const bookingId = params.bookingId && isValidUuid(params.bookingId) ? params.bookingId : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getProviderPayments({ status, bookingId, page });
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

  const t = await getServerTranslator("payments");
  const paymentsBasePath = getPathname({ href: "/provider/payments", locale });
  const hasActiveFilter = Boolean(params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("providerPaymentsPageTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("providerPaymentsPageDescription")}</p>
      </div>

      {bookingId && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-accent/10 px-4 py-2.5 text-sm">
          <span className="text-foreground/70">{t("filteredByBookingLabel")}</span>
          <Link href="/provider/payments" className="font-medium text-primary hover:underline">
            {t("clearFilterLabel")}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <Banknote size={18} strokeWidth={1.75} className="text-success" />
          {result.summary.capturedByCurrency.length === 0 ? (
            <span className="text-sm text-foreground/40">—</span>
          ) : (
            result.summary.capturedByCurrency.map((entry) => (
              <span key={entry.currency} className="text-lg font-semibold text-foreground">
                {entry.amount} <span className="text-xs font-medium text-foreground/50">{entry.currency}</span>
              </span>
            ))
          )}
          <span className="text-xs text-foreground/50">{t("capturedByCurrencyLabel")}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <Undo2 size={18} strokeWidth={1.75} className="text-secondary" />
          {result.summary.refundedByCurrency.length === 0 ? (
            <span className="text-sm text-foreground/40">—</span>
          ) : (
            result.summary.refundedByCurrency.map((entry) => (
              <span key={entry.currency} className="text-lg font-semibold text-foreground">
                {entry.amount} <span className="text-xs font-medium text-foreground/50">{entry.currency}</span>
              </span>
            ))
          )}
          <span className="text-xs text-foreground/50">{t("refundedByCurrencyLabel")}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <Clock size={18} strokeWidth={1.75} className="text-accent-foreground" />
          <span className="text-lg font-semibold text-foreground">{result.summary.initiatedCount}</span>
          <span className="text-xs text-foreground/50">{t("initiatedCountLabel")}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <XCircle size={18} strokeWidth={1.75} className="text-danger" />
          <span className="text-lg font-semibold text-foreground">{result.summary.failedCount}</span>
          <span className="text-xs text-foreground/50">{t("failedCountLabel")}</span>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">{t("filterStatusAllLabel")}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {getPaymentStatusLabel(value, t)}
            </option>
          ))}
        </select>
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("applyFiltersButton")}
        </button>
      </form>

      {result.totalCount === 0 && !hasActiveFilter && !bookingId ? (
        <EmptyState icon={CreditCard} message={t("noProviderPaymentsLabel")} description={t("noProviderPaymentsDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CreditCard} message={t("paymentsNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CreditCard} message={t("noPaymentsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">{payment.serviceName}</span>
                <span className="text-xs text-foreground/40">
                  {formatDate(payment.createdAt, locale, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-medium text-foreground">
                  {payment.amount} {payment.currency}
                </span>
                <Badge variant={getPaymentStatusBadgeVariant(payment.status)}>{getPaymentStatusLabel(payment.status, t)}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={paymentsBasePath} />
    </div>
  );
}
