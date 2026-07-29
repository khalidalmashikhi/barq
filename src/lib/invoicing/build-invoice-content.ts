import "server-only";

// Invoice content builder — Phase 2.13 (Invoice Foundation).
//
// Deliberately a plain bilingual { ar, en } object — the exact same
// shape every other bilingual field in this schema already uses
// (Provider.businessName, Service.name, etc.), and the same shape
// prisma/seed.ts already hand-wrote for its one seeded Invoice row
// ("Booking invoice for {amount} {currency}"). This is data stored in
// Invoice.content, not a rendered document — PDF generation and print
// layout are explicitly out of this phase's scope (unlike Contracts,
// where the template engine and PDF service were always two distinct,
// separately-built phases — E.2 vs E.3 — this Foundation phase is the
// E.2 equivalent only).
//
// Per DATABASE_DESIGN.md §7: monetary amounts are non-localized content
// (paired with a language-neutral currency code) — never bilingual-
// duplicated as if the number itself changed meaning per language.
// Only the surrounding sentence is translated; the amount/currency
// values themselves are identical in both languages, exactly as the
// seed script's own precedent already does.

export type InvoiceContentInput = {
  serviceName: { ar: string; en: string };
  amount: string;
  currency: string;
};

export type InvoiceContent = { ar: string; en: string };

export function buildInvoiceContent(input: InvoiceContentInput): InvoiceContent {
  const { serviceName, amount, currency } = input;

  return {
    ar: `فاتورة حجز خدمة "${serviceName.ar}" بمبلغ ${amount} ${currency}`,
    en: `Invoice for booking "${serviceName.en}" — ${amount} ${currency}`,
  };
}
