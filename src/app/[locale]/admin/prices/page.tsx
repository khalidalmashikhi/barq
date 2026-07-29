import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Tag, Plus } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getPrices } from "@/lib/admin/get-prices";
import { deactivatePrice } from "@/lib/admin/deactivate-price";
import { getPriceStatusBadgeVariant, getPriceStatusTranslationKey } from "@/lib/admin/presentation/price-status";
import { isPriceAdminActionErrorCode, getPriceAdminErrorTranslationKey } from "@/lib/admin/price-admin-errors";
import { PriceFilters } from "@/components/admin/price-filters";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { PriceStatus } from "@prisma/client";

// Admin Prices — Phase 2.6 (Pricing Admin UI), consuming the Phase 2.5
// (Pricing Foundation) admin actions/queries. Mirrors
// admin/services/page.tsx's list-page shape exactly (row-list, 3-tier
// empty state, Pagination, filters-as-plain-GET-form). "Update Price"
// is a link to a dedicated form (not a one-click button), since
// changing a price needs a new amount value, not a toggle — Deactivate
// stays a one-click form action, same as Archive elsewhere.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const PRICE_STATUSES: PriceStatus[] = ["ACTIVE", "SUPERSEDED"];

type SearchParams = { serviceId?: string; status?: string; page?: string; error?: string };

export default async function AdminPricesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const status = PRICE_STATUSES.includes(params.status as PriceStatus) ? (params.status as PriceStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getPrices() calls requireAdmin() internally — same catch-and-handle
  // pattern as every other role-gated query call site in this
  // codebase, even though admin/layout.tsx already gates this route:
  // defense in depth, not redundancy.
  let result;
  try {
    result = await getPrices({ serviceId: params.serviceId, status, page });
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

  const hasActiveFilter = Boolean(params.serviceId || params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const pricesBasePath = getPathname({ href: "/admin/prices", locale });
  const errorMessage = params.error && isPriceAdminActionErrorCode(params.error) ? t(getPriceAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("pricesTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("pricesDescription")}</p>
        </div>
        <Link
          href="/admin/prices/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createPriceButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <PriceFilters currentServiceId={params.serviceId} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={Tag} message={t("noPricesManagedLabel")} description={t("noPricesManagedDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={Tag} message={t("pricesNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={Tag} message={t("noPricesMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((price) => (
            <div key={price.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/prices/${price.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {price.amount} {price.currency}
                </p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">{price.serviceName}</p>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getPriceStatusBadgeVariant(price.status)}>{t(getPriceStatusTranslationKey(price.status))}</Badge>

                {price.status === "ACTIVE" && (
                  <Link
                    href={`/admin/prices/${price.id}/update`}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                  >
                    {t("updatePriceButton")}
                  </Link>
                )}

                {price.status === "ACTIVE" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await deactivatePrice(price.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/prices?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/prices", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                      {t("deactivatePriceButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={pricesBasePath} />
    </div>
  );
}
