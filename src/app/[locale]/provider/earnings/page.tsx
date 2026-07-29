import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wallet, PiggyBank, XCircle, Hourglass, Receipt, CalendarClock, CalendarRange, CreditCard } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderEarnings } from "@/lib/provider/queries/get-provider-earnings";
import { EarningsMetricCard } from "@/components/provider/earnings-metric-card";
import { ServiceRevenueTable } from "@/components/provider/service-revenue-table";
import { Alert } from "@/components/ui/alert";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider Earnings — Provider Billing & Earnings Foundation.
//
// SCOPE BOUNDARY, READ BEFORE EXTENDING: this page is an operational
// financial SUMMARY derived from Booking.priceSnapshotAmount /
// commissionSnapshotAmount. It is NOT accounting, NOT a payout or
// settlement system, NOT invoice reconciliation, NOT tax reporting,
// and NOT a wallet balance — see get-provider-earnings.ts's own module
// comment for the full rationale and the confirmed absence of any
// real Payment/Invoice/Wallet aggregation elsewhere in this codebase.
// A future phase building real payout/settlement/accounting must do so
// against its own real data source — do not silently expand this
// page's numbers to imply something they were never designed to mean.
//
// DOES NOT DUPLICATE THE DASHBOARD'S "Revenue (Completed)" KPI: that
// card (src/app/[locale]/provider/page.tsx, via get-provider-
// metrics.ts) stays exactly as it was — this page is the detailed
// financial view a provider reaches via the dashboard's Quick Actions.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProviderEarningsPage() {
  const locale = await getLocale();

  let earnings;
  try {
    earnings = await getProviderEarnings();
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

  const t = await getServerTranslator("provider");
  const tPayments = await getServerTranslator("payments");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("earningsPageTitle")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">{t("earningsPageSubtitle")}</p>
      </div>

      <Alert variant="info">{t("earningsScopeNoteLabel")}</Alert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <EarningsMetricCard
          label={t("grossRevenueLabel")}
          icon={Wallet}
          amounts={earnings.grossRevenueByCurrency}
          emptyLabel={t("noEarningsDataLabel")}
        />
        <EarningsMetricCard
          label={t("estimatedNetEarningsLabel")}
          icon={PiggyBank}
          amounts={earnings.estimatedNetEarningsByCurrency}
          emptyLabel={t("noEarningsDataLabel")}
          helpText={t("estimatedNetEarningsHelpText")}
        />
        <EarningsMetricCard
          label={t("averageBookingValueLabel")}
          icon={Receipt}
          amounts={earnings.averageBookingValueByCurrency}
          emptyLabel={t("noEarningsDataLabel")}
        />
        <EarningsMetricCard
          label={t("grossRevenueTodayLabel")}
          icon={CalendarClock}
          amounts={earnings.grossRevenueTodayByCurrency}
          emptyLabel={t("noEarningsTodayLabel")}
        />
        <EarningsMetricCard
          label={t("grossRevenueThisMonthLabel")}
          icon={CalendarRange}
          amounts={earnings.grossRevenueThisMonthByCurrency}
          emptyLabel={t("noEarningsThisMonthLabel")}
        />
        <EarningsMetricCard
          label={t("pendingRevenueLabel")}
          icon={Hourglass}
          amounts={earnings.pendingRevenueByCurrency}
          emptyLabel={t("noPendingRevenueLabel")}
        />
        <EarningsMetricCard
          label={t("cancelledLostRevenueLabel")}
          icon={XCircle}
          amounts={earnings.cancelledLostRevenueByCurrency}
          emptyLabel={t("noCancelledRevenueLabel")}
        />
      </div>

      <ServiceRevenueTable groups={earnings.revenueByService} />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CreditCard size={16} strokeWidth={1.75} className="text-foreground/40" />
          {tPayments("earningsVsPaymentsTitle")}
        </h2>
        <p className="text-xs leading-relaxed text-foreground/60">{tPayments("earningsVsPaymentsDescription")}</p>
        <Link
          href="/provider/payments"
          className="self-start rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
        >
          {tPayments("viewPaymentsLabel")}
        </Link>
      </div>
    </div>
  );
}
