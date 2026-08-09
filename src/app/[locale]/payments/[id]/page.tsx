import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, FileText } from "lucide-react";
import { redirect, Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError } from "@/lib/auth";
import { getMyPaymentDetail } from "@/lib/payments/get-my-payment-detail";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/payments/payment-status";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { resolveCustomerNavOptions } from "@/lib/dashboard/resolve-customer-nav-options";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isValidUuid } from "@/lib/uuid";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import type { InvoiceStatus } from "@prisma/client";

// Customer Payment Detail — Payment Experience & Financial Operations
// phase. "Payment Record" section presents only real Payment fields
// (never a fabricated receipt number, never a tax figure). The Invoice
// section is a separate lifecycle: an honest "not issued" state when no
// Invoice exists for this booking, never treated as an error.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const INVOICE_STATUS_LABEL_KEYS: Record<InvoiceStatus, "invoiceStatusGeneratedLabel" | "invoiceStatusIssuedLabel" | "invoiceStatusSupersededLabel"> = {
  GENERATED: "invoiceStatusGeneratedLabel",
  ISSUED: "invoiceStatusIssuedLabel",
  SUPERSEDED_BY_CREDIT_NOTE: "invoiceStatusSupersededLabel",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function PaymentDetailPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let payment;
  try {
    payment = await getMyPaymentDetail(id);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  if (!payment) {
    notFound();
  }

  const t = await getServerTranslator("payments");
  const tDashboard = await getServerTranslator("dashboard");
  const [unreadNotificationsCount, navOptions] = await Promise.all([getUnreadCount(), resolveCustomerNavOptions()]);

  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount, navOptions)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <div className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
        <Link href="/payments" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
          <ArrowRight size={16} strokeWidth={1.75} />
          {t("backToPaymentsLabel")}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{payment.serviceName}</h1>
            <p className="mt-0.5 text-sm text-foreground/50">{payment.providerName}</p>
          </div>
          <Badge variant={getPaymentStatusBadgeVariant(payment.status)}>{getPaymentStatusLabel(payment.status, t)}</Badge>
        </div>

        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground">{t("paymentDetailsTitle")}</h2>
          <p className="mt-1 text-xs text-foreground/50">{t("paymentRecordDescription")}</p>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-foreground/50">{t("amountLabel")}</dt>
              <dd className="font-medium text-foreground">
                {payment.amount} {payment.currency}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-foreground/50">{t("statusLabel")}</dt>
              <dd className="font-medium text-foreground">{getPaymentStatusLabel(payment.status, t)}</dd>
            </div>
            {payment.refundAmount !== null && (
              <div className="flex items-center justify-between">
                <dt className="text-foreground/50">{t("refundAmountLabel")}</dt>
                <dd className="font-medium text-foreground">
                  {payment.refundAmount} {payment.currency}
                </dd>
              </div>
            )}
            {payment.capturedAt && (
              <div className="flex items-center justify-between">
                <dt className="text-foreground/50">{t("capturedOnLabel")}</dt>
                <dd className="font-medium text-foreground">
                  {formatDate(payment.capturedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-foreground/50">{t("createdOnLabel")}</dt>
              <dd className="font-medium text-foreground">
                {formatDate(payment.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          </dl>
        </Card>

        <Card hoverLift={false}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText size={16} strokeWidth={1.75} className="text-foreground/40" />
            {t("invoiceTitle")}
          </h2>
          {payment.invoice ? (
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-foreground/50">{t("invoiceNumberLabel")}</dt>
                <dd dir="ltr" className="font-medium text-foreground">
                  {payment.invoice.invoiceNumber}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-foreground/50">{t("statusLabel")}</dt>
                <dd className="font-medium text-foreground">{t(INVOICE_STATUS_LABEL_KEYS[payment.invoice.status])}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-foreground/50">{t("invoiceIssuedOnLabel")}</dt>
                <dd className="font-medium text-foreground">
                  {formatDate(payment.invoice.issuedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                </dd>
              </div>
              <p className="text-foreground/70">{payment.invoice.content}</p>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-foreground/50">{t("invoiceNotIssuedLabel")}</p>
          )}
        </Card>

        <Link
          href={`/bookings/${payment.bookingId}`}
          className="self-start rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
        >
          {t("viewBookingLabel")}
        </Link>
      </div>
    </AppShell>
  );
}
