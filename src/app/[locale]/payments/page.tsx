import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { redirect, getPathname, Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, isActiveAdminSession } from "@/lib/auth";
import { getMyPayments } from "@/lib/payments/get-my-payments";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/payments/payment-status";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { resolveCustomerNavOptions } from "@/lib/dashboard/resolve-customer-nav-options";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import type { PaymentStatus } from "@prisma/client";

// Customer Payment History — Payment Experience & Financial Operations
// phase. Read-only history of real Payment records for this customer's
// own bookings, scoped entirely by getMyPayments() (booking.customerId).
// Every one of the 5 PaymentStatus values is filterable and rendered
// with its own distinct label/badge — never collapsed to Completed/Pending.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STATUSES: PaymentStatus[] = ["INITIATED", "CAPTURED", "REFUNDED_PARTIAL", "REFUNDED_FULL", "FAILED"];

type SearchParams = {
  status?: string;
  page?: string;
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const locale = await getLocale();

  // Gate A (Admin Backoffice Hardening) — an ACTIVE Admin is backoffice-only:
  // redirect it to /admin SERVER-SIDE before any customer payment read.
  if (await isActiveAdminSession()) {
    redirect({ href: "/admin", locale });
    return null;
  }

  const status = STATUSES.includes(params.status as PaymentStatus) ? (params.status as PaymentStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getMyPayments({ status, page });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  const t = await getServerTranslator("payments");
  const tDashboard = await getServerTranslator("dashboard");
  const [unreadNotificationsCount, navOptions] = await Promise.all([getUnreadCount(), resolveCustomerNavOptions()]);

  const hasActiveFilter = Boolean(params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const paymentsBasePath = getPathname({ href: "/payments", locale });

  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount, navOptions)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("paymentsPageTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("paymentsPageDescription")}</p>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
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
          <button
            type="submit"
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("applyFiltersButton")}
          </button>
        </form>

        {result.totalCount === 0 && !hasActiveFilter ? (
          <EmptyState icon={CreditCard} message={t("noPaymentsLabel")} description={t("noPaymentsDescription")} />
        ) : isOutOfRangePage ? (
          <EmptyState icon={CreditCard} message={t("paymentsNoResultsOnPageLabel")} />
        ) : result.items.length === 0 ? (
          <EmptyState icon={CreditCard} message={t("noPaymentsMatchLabel")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {result.items.map((payment) => (
              <li key={payment.id}>
                <Link
                  href={`/payments/${payment.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent/10"
                >
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
                    <Badge variant={getPaymentStatusBadgeVariant(payment.status)}>
                      {getPaymentStatusLabel(payment.status, t)}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={paymentsBasePath} />
      </div>
    </AppShell>
  );
}
