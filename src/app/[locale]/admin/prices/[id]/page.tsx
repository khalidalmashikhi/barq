import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getPriceDetail } from "@/lib/admin/get-price-detail";
import { deactivatePrice } from "@/lib/admin/deactivate-price";
import { getPriceStatusBadgeVariant, getPriceStatusTranslationKey } from "@/lib/admin/presentation/price-status";
import { isPriceAdminActionErrorCode, getPriceAdminErrorTranslationKey } from "@/lib/admin/price-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Price detail — Phase 2.6 (Pricing Admin UI). Mirrors
// admin/services/[id]/page.tsx's shape: status-changing actions live
// here (needs more room than a list row), the list row keeps
// single-click quick actions. "Update Price" links to a dedicated form
// rather than being an inline action, since it needs a new amount
// value, not a toggle.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function PriceDetailPage({ params, searchParams }: Props) {
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/prices" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToPricesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {price.amount} {price.currency}
          </h1>
          <p className="mt-0.5 text-sm text-foreground/40">{price.serviceName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getPriceStatusBadgeVariant(price.status)}>{t(getPriceStatusTranslationKey(price.status))}</Badge>
          {price.status === "ACTIVE" && (
            <Link
              href={`/admin/prices/${id}/update`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            >
              {t("updatePriceButton")}
            </Link>
          )}
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("priceDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("priceServiceLabel")}</dt>
            <dd className="text-sm text-foreground">{price.serviceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("priceAmountLabel")}</dt>
            <dd className="text-sm text-foreground">
              {price.amount} {price.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("priceCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(price.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      {price.status === "ACTIVE" && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground">{t("priceActionsTitle")}</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <form
              action={async () => {
                "use server";
                const result = await deactivatePrice(id);
                if (!result.ok) {
                  redirect({ href: `/admin/prices/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/prices/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("deactivatePriceButton")}
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}
