import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { PaymentStatus, InvoiceStatus } from "@prisma/client";

// My Payment Detail query (Customer) — Payment Experience & Financial
// Operations phase. Mirrors get-booking-detail.ts's (customer) uniform-
// 404 ownership convention exactly: a malformed id, a genuinely missing
// Payment, and a Payment belonging to another customer's booking all
// return null identically, via one `findFirst` scoped by
// `booking.customerId` — never a separate ownership check that could
// diverge from the query itself.
//
// INVOICE IS A SEPARATE, HONEST LIFECYCLE: `invoice` is null whenever
// no Invoice row exists for this booking (e.g. it never reached
// COMPLETED) — the caller must render an honest "not issued" state,
// never an error. Invoice.content is stored, structured bilingual text
// (see complete-booking.ts / build-invoice-content.ts) — never a PDF.
//
// NEVER RETURNED: providerReference (gateway internals).

export type MyPaymentDetailInvoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: Date;
  content: string;
};

export type MyPaymentDetail = {
  id: string;
  bookingId: string;
  serviceName: string;
  providerName: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  refundAmount: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  invoice: MyPaymentDetailInvoice | null;
} | null;

export async function getMyPaymentDetail(paymentId: string): Promise<MyPaymentDetail> {
  if (!isValidUuid(paymentId)) return null;

  const { barqUser } = await requireAuth();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) return null;

  const locale = await getLocale();

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, booking: { customerId: customer.id } },
    include: {
      booking: { include: { service: true, provider: true } },
      invoice: true,
    },
  });

  if (!payment) return null;

  type PaymentRow = {
    id: string;
    bookingId: string;
    amount: unknown;
    currency: string;
    status: PaymentStatus;
    refundAmount: unknown;
    capturedAt: Date | null;
    createdAt: Date;
    booking: { service: { name: unknown }; provider: { businessName: unknown } };
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
    serviceName: extractLocalizedText(row.booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerName:
      extractLocalizedText(row.booking.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    amount: String(row.amount),
    currency: row.currency,
    status: row.status,
    refundAmount: row.refundAmount !== null ? String(row.refundAmount) : null,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
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
