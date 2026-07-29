import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { InvoiceStatus } from "@prisma/client";

// Admin Payment detail query — Phase 2.12 (Payment Foundation). Mirrors
// get-booking-detail.ts's (admin) shape: unscoped, behind requireAdmin(),
// no ownership restriction. Surfaces the linked Booking's identifying
// context (service/provider/customerId) since a Payment record alone
// carries only bookingId — same join Payment.booking already provides,
// nothing duplicated from get-booking-detail.ts's own query.
//
// PAYMENT EXPERIENCE & FINANCIAL OPERATIONS PHASE — additive, backward
// compatible extension: providerId/serviceId (for admin cross-links to
// the existing Provider/Service detail pages) and `invoice` (read-only,
// stored bilingual content — never a PDF, never fabricated line items/
// tax/billing-address fields that don't exist on the Invoice model).
// `providerReference` is deliberately NOT added here — it is surfaced
// separately, labeled "Gateway Reference," only on the page that reads
// it directly off the raw Prisma row, never folded into this shared DTO
// shape (kept out of any type that could later be reused by a
// customer/provider-facing caller).

export type PaymentAdminDetailInvoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: Date;
  content: string;
};

export type PaymentAdminDetail = {
  id: string;
  bookingId: string;
  customerId: string;
  providerId: string;
  serviceId: string;
  serviceName: string;
  providerName: string;
  amount: string;
  currency: string;
  status: string;
  refundAmount: string | null;
  providerReference: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invoice: PaymentAdminDetailInvoice | null;
} | null;

export async function getPaymentDetail(paymentId: string): Promise<PaymentAdminDetail> {
  await requireAdmin();

  if (!isValidUuid(paymentId)) {
    return null;
  }

  const locale = await getLocale();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { include: { service: true, provider: true } }, invoice: true },
  });

  if (!payment) {
    return null;
  }

  type PaymentRow = {
    id: string;
    bookingId: string;
    amount: unknown;
    currency: string;
    status: string;
    refundAmount: unknown;
    providerReference: string | null;
    capturedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    booking: {
      customerId: string;
      providerId: string;
      serviceId: string;
      service: { name: unknown };
      provider: { businessName: unknown };
    };
    invoice: {
      id: string;
      invoiceNumber: string;
      status: InvoiceStatus;
      issuedAt: Date;
      content: unknown;
    } | null;
  };

  const row = payment as PaymentRow;

  return {
    id: row.id,
    bookingId: row.bookingId,
    customerId: row.booking.customerId,
    providerId: row.booking.providerId,
    serviceId: row.booking.serviceId,
    serviceName: extractLocalizedText(row.booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName:
      extractLocalizedText(row.booking.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    amount: String(row.amount),
    currency: row.currency,
    status: row.status,
    refundAmount: row.refundAmount !== null ? String(row.refundAmount) : null,
    providerReference: row.providerReference,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    invoice: row.invoice
      ? {
          id: row.invoice.id,
          invoiceNumber: row.invoice.invoiceNumber,
          status: row.invoice.status,
          issuedAt: row.invoice.issuedAt,
          content: extractLocalizedText(row.invoice.content, locale),
        }
      : null,
  };
}
