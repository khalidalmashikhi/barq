import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createPrice } from "@/lib/admin/create-price";
import { isPriceAdminActionErrorCode, getPriceAdminErrorTranslationKey } from "@/lib/admin/price-admin-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { PricingUnitField } from "@/components/pricing-units/pricing-unit-field";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Price (admin-initiated) — Phase 2.6 (Pricing Admin UI).
// Mirrors admin/services/new/page.tsx's form shape. Only valid when the
// target service has no current ACTIVE price yet (createPrice() itself
// enforces this, returning PRICE_ALREADY_ACTIVE otherwise — the UI
// surfaces that error, it never duplicates the check). No currency
// field: createPrice() hardcodes "OMR", same reasoning as
// create-service.ts's own hardcoded currency.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewPricePage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isPriceAdminActionErrorCode(error) ? t(getPriceAdminErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/prices" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToPricesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createPriceTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createPrice(formData);
            if (!result.ok) {
              redirect({ href: `/admin/prices/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/prices/${result.priceId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("priceServiceIdLabel")}</span>
            <input
              type="text"
              name="serviceId"
              required
              dir="ltr"
              placeholder="019f4e4e-8116-7052-b15e-000000000000"
              className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("priceServiceIdHintLabel")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("priceAmountLabel")}</span>
            <input
              type="text"
              name="amount"
              required
              dir="ltr"
              placeholder="25.00"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {/* PRICING UNIT DATA INTEGRITY — a governed, bookable unit is required for a new
              ACTIVE price (createPrice re-validates server-side). */}
          <PricingUnitField />

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createPriceSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
