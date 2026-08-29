import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getPriceDetail } from "@/lib/admin/get-price-detail";
import { updatePrice } from "@/lib/admin/update-price";
import { isPriceAdminActionErrorCode, getPriceAdminErrorTranslationKey } from "@/lib/admin/price-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { PricingUnitField } from "@/components/pricing-units/pricing-unit-field";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Update Price — Phase 2.6 (Pricing Admin UI). Deliberately NOT an
// in-place edit form, unlike Provider/Service's own "Edit" pages: Price
// is append-only/versioned (Phase 2.5), so this calls updatePrice()
// with only the new amount — the backend action itself supersedes the
// current ACTIVE price and creates a brand-new one in the same
// transaction. The UI never touches status directly and never mutates
// this price row; it only ever reads the current amount for display
// context and submits the new one. On success, redirects to the NEW
// price's detail page (this one is now SUPERSEDED).
//
// Only reachable from an ACTIVE price's detail/list row (see
// admin/prices/page.tsx and admin/prices/[id]/page.tsx); if reached
// directly for an already-SUPERSEDED price, updatePrice() itself
// correctly refuses with NO_ACTIVE_PRICE — no duplicated check here.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function UpdatePricePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let price;
  try {
    price = await getPriceDetail(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  if (!price) {
    notFound();
  }

  const errorMessage = error && isPriceAdminActionErrorCode(error) ? t(getPriceAdminErrorTranslationKey(error)) : null;
  const serviceId = price.serviceId;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href={`/admin/prices/${id}`} className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToPriceLabel")}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("updatePriceTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("updatePriceDescription")}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updatePrice(serviceId, formData);
            if (!result.ok) {
              redirect({ href: `/admin/prices/${id}/update?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/prices/${result.priceId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <span className="text-xs font-medium text-foreground/50">{t("currentPriceLabel")}</span>
            <p className="mt-1 text-sm text-foreground">
              {price.amount} {price.currency}
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("newPriceAmountLabel")}</span>
            <input
              type="text"
              name="amount"
              required
              dir="ltr"
              placeholder="25.00"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {/* PRICING UNIT DATA INTEGRITY — the superseding ACTIVE price must carry a governed,
              bookable unit. Pre-filled with the current unit; a legacy NULL-unit price is
              corrected by choosing one here (updatePrice re-validates server-side). */}
          <PricingUnitField defaultValue={price.pricingUnit} />

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("updatePriceSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
