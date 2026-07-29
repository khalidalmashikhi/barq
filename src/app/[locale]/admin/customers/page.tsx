import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { UserRound } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCustomers } from "@/lib/admin/get-customers";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";

// Admin Customers — Admin Operations Platform. First admin-facing
// Customer surface in the codebase (read-only — no create/edit/status
// action exists, since a Customer profile is created only through the
// customer's own self-service flow). Mirrors admin/feature-flags/page.tsx's
// simplest list shape (plain GET-form search, no status filter — a
// Customer has no status field to filter by). No name/email/avatar is
// shown or fabricated — phone number is the only real display identity
// (see get-customers.ts's own header comment).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = { q?: string; page?: string };

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getCustomers({ q: params.q, page });
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

  const hasActiveFilter = Boolean(params.q);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const customersBasePath = getPathname({ href: "/admin/customers", locale });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("customersTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("customersDescription")}</p>
      </div>

      <form
        method="get"
        className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
      >
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={t("customersSearchPlaceholder")}
          aria-label={t("customersSearchPlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("customersSearchButton")}
        </button>
      </form>

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={UserRound} message={t("noCustomersLabel")} description={t("noCustomersDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={UserRound} message={t("customersNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={UserRound} message={t("noCustomersMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((customer) => (
            <Link
              key={customer.id}
              href={`/admin/customers/${customer.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent/10"
            >
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-start font-medium text-foreground">{customer.phoneNumber}</p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">
                  {formatDate(customer.createdAt, locale, { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-foreground/60">
                <span>{t("customerBookingCountLabel", { count: customer.bookingCount })}</span>
                <span>{t("customerReviewCountLabel", { count: customer.reviewCount })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={customersBasePath} />
    </div>
  );
}
