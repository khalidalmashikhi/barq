import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, UserRound, Users, Compass, ClipboardList, FileText } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getPaymentDetail } from "@/lib/admin/get-payment-detail";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/payments/payment-status";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { isValidUuid } from "@/lib/uuid";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import type { InvoiceStatus } from "@prisma/client";

// Admin Payment Detail — Payment Experience & Financial Operations
// phase. READ-ONLY BY DESIGN: capture-payment.ts/refund-payment.ts
// already exist in the backend, but this page renders no form, no
// button, and no action menu for either — the note below states this
// honestly rather than silently omitting it. providerReference is
// shown only here, labeled "Gateway Reference," never parsed or
// exposed to Customer/Provider.

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

export default async function AdminPaymentDetailPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let payment;
  try {
    payment = await getPaymentDetail(id);
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

  if (!payment) {
    notFound();
  }

  const t = await getServerTranslator("payments");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/payments" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToPaymentsLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{payment.serviceName}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">{payment.providerName}</p>
        </div>
        <Badge variant={getPaymentStatusBadgeVariant(payment.status)}>{getPaymentStatusLabel(payment.status, t)}</Badge>
      </div>

      <Alert variant="info">{t("adminActionsDeferredNote")}</Alert>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("paymentDetailsAdminTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("amountLabel")}</dt>
            <dd className="text-sm text-foreground">
              {payment.amount} {payment.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("statusLabel")}</dt>
            <dd className="text-sm text-foreground">{getPaymentStatusLabel(payment.status, t)}</dd>
          </div>
          {payment.refundAmount !== null && (
            <div>
              <dt className="text-xs text-foreground/40">{t("refundAmountLabel")}</dt>
              <dd className="text-sm text-foreground">
                {payment.refundAmount} {payment.currency}
              </dd>
            </div>
          )}
          {payment.capturedAt && (
            <div>
              <dt className="text-xs text-foreground/40">{t("capturedOnLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(payment.capturedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("createdOnLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(payment.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
          {payment.providerReference && (
            <div>
              <dt className="text-xs text-foreground/40">{t("gatewayReferenceLabel")}</dt>
              <dd dir="ltr" className="truncate text-sm text-foreground">
                {payment.providerReference}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText size={16} strokeWidth={1.75} className="text-foreground/40" />
          {t("invoiceTitle")}
        </h2>
        {payment.invoice ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-foreground/40">{t("invoiceNumberLabel")}</dt>
              <dd dir="ltr" className="text-sm text-foreground">
                {payment.invoice.invoiceNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/40">{t("statusLabel")}</dt>
              <dd className="text-sm text-foreground">{t(INVOICE_STATUS_LABEL_KEYS[payment.invoice.status])}</dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/40">{t("invoiceIssuedOnLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(payment.invoice.issuedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-foreground/50">{t("invoiceNotIssuedLabel")}</p>
        )}
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("relatedTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/admin/customers/${payment.customerId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <UserRound size={14} strokeWidth={1.75} />
            {t("viewPaymentCustomerLabel")}
          </Link>
          <Link
            href={`/admin/providers/${payment.providerId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Users size={14} strokeWidth={1.75} />
            {t("viewPaymentProviderLabel")}
          </Link>
          <Link
            href={`/admin/services/${payment.serviceId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Compass size={14} strokeWidth={1.75} />
            {t("viewPaymentServiceLabel")}
          </Link>
          <Link
            href={`/admin/bookings/${payment.bookingId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <ClipboardList size={14} strokeWidth={1.75} />
            {t("viewPaymentBookingLabel")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
