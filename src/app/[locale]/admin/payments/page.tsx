import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard, Banknote, Undo2 } from "lucide-react";
import { Link, redirect, getPathname } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getPayments } from "@/lib/admin/get-payments";
import { getPaymentOverviewMetrics } from "@/lib/admin/get-payment-overview-metrics";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/payments/payment-status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import { isValidUuid } from "@/lib/uuid";
import type { PaymentStatus } from "@prisma/client";

// Admin Payments — Payment Experience & Financial Operations phase.
// Reuses get-payments.ts unchanged. Read-only: no capture/refund action
// exists on this page or anywhere else this phase adds — the backend
// capture-payment.ts/refund-payment.ts actions remain intentionally
// unwired to any UI (per this phase's own approved scope).
//
// Filters exposed here are exactly what get-payments.ts already
// supports (q, status, bookingId) — no new filter (e.g. currency) was
// added to that query module for this phase.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STATUSES: PaymentStatus[] = ["INITIATED", "CAPTURED", "REFUNDED_PARTIAL", "REFUNDED_FULL", "FAILED"];

type SearchParams = {
  q?: string;
  status?: string;
  bookingId?: string;
  page?: string;
};

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const locale = await getLocale();

  const status = STATUSES.includes(params.status as PaymentStatus) ? (params.status as PaymentStatus) : undefined;
  const bookingId = params.bookingId && isValidUuid(params.bookingId) ? params.bookingId : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  let overview;
  try {
    [result, overview] = await Promise.all([
      getPayments({ q: params.q, status, bookingId, page }),
      getPaymentOverviewMetrics(),
    ]);
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
  const paymentsBasePath = getPathname({ href: "/admin/payments", locale });
  const hasActiveFilter = Boolean(params.q || params.status || params.bookingId);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("paymentsAdminTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("paymentsAdminDescription")}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">{t("paymentOverviewTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STATUSES.map((value) => (
            <div key={value} className="flex flex-col gap-1 rounded-xl bg-accent/10 p-3">
              <span className="text-lg font-semibold text-foreground">{overview.countsByStatus[value]}</span>
              <span className="text-xs text-foreground/50">{getPaymentStatusLabel(value, t)}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl bg-accent/10 p-3">
            <span className="flex items-center gap-1.5 text-xs text-foreground/50">
              <Banknote size={14} strokeWidth={1.75} />
              {t("capturedByCurrencyLabel")}
            </span>
            {overview.capturedByCurrency.length === 0 ? (
              <span className="text-sm text-foreground/40">—</span>
            ) : (
              overview.capturedByCurrency.map((entry) => (
                <span key={entry.currency} className="text-base font-semibold text-foreground">
                  {entry.amount} <span className="text-xs font-medium text-foreground/50">{entry.currency}</span>
                </span>
              ))
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-accent/10 p-3">
            <span className="flex items-center gap-1.5 text-xs text-foreground/50">
              <Undo2 size={14} strokeWidth={1.75} />
              {t("refundedByCurrencyLabel")}
            </span>
            {overview.refundedByCurrency.length === 0 ? (
              <span className="text-sm text-foreground/40">—</span>
            ) : (
              overview.refundedByCurrency.map((entry) => (
                <span key={entry.currency} className="text-base font-semibold text-foreground">
                  {entry.amount} <span className="text-xs font-medium text-foreground/50">{entry.currency}</span>
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      <form method="get" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
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

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CreditCard} message={t("noPaymentsAdminLabel")} description={t("noPaymentsAdminDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CreditCard} message={t("paymentsNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CreditCard} message={t("noPaymentsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((payment) => (
            <Link
              key={payment.id}
              href={`/admin/payments/${payment.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent/10"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">{payment.serviceName}</span>
                <span className="mt-0.5 truncate text-xs text-foreground/40">{payment.providerName}</span>
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
            </Link>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={paymentsBasePath} />
    </div>
  );
}
