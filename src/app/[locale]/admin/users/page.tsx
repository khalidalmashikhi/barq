import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect, getPathname } from "@/i18n/navigation";
import { ShieldCheck } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAdmins } from "@/lib/admin/get-admins";
import { getStaff } from "@/lib/admin/get-staff";
import { getProviders } from "@/lib/admin/get-providers";
import { getCustomers } from "@/lib/admin/get-customers";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import type { AdminStatus, StaffStatus, ProviderStatus, UserStatus } from "@prisma/client";

// Admin → User & Access Management (Batch 2) — read-only. Four tabs
// (Administrators / Staff / Providers / Customers), each a searchable,
// status-filterable, paginated list following the existing admin-page pattern
// (GET-form search, Pagination, EmptyState, Badge). No mutations here — those
// arrive in later batches. Identity is phone + User ID only (providers also by
// businessName); no name/email is shown or searched.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const TABS = ["administrators", "staff", "providers", "customers"] as const;
type Tab = (typeof TABS)[number];

const STATUSES_BY_TAB: Record<Tab, readonly string[]> = {
  administrators: ["ACTIVE", "DEACTIVATED"],
  staff: ["ACTIVE", "DEACTIVATED"],
  providers: ["APPLIED", "UNDER_REVIEW", "APPROVED", "SUSPENDED", "DEACTIVATED"],
  customers: ["CREATED", "VERIFIED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
};

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "ACTIVE":
    case "APPROVED":
    case "VERIFIED":
      return "success";
    case "DEACTIVATED":
      return "danger";
    case "SUSPENDED":
      return "warning";
    default:
      return "info"; // APPLIED / UNDER_REVIEW / CREATED
  }
}

type RowVM = { key: string; primary: string; secondary?: string; status: string; meta: string[] };

type SearchParams = { tab?: string; q?: string; status?: string; page?: string };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "administrators";
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
  const q = params.q?.trim() || undefined;
  // Ignore a status value that isn't valid for this tab (e.g. a manipulated
  // URL) rather than passing it to Prisma and crashing on an invalid enum.
  const status = params.status && STATUSES_BY_TAB[tab].includes(params.status) ? params.status : undefined;

  const dateFmt = (d: Date) => formatDate(d, locale, { day: "numeric", month: "short", year: "numeric" });

  // Literal-key status label lookup — next-intl's message keys are typed, so a
  // dynamic `um_status_${string}` key is rejected; this resolves via known
  // literal keys instead.
  const statusLabel = (s: string): string => {
    switch (s) {
      case "ACTIVE": return t("um_status_ACTIVE");
      case "DEACTIVATED": return t("um_status_DEACTIVATED");
      case "SUSPENDED": return t("um_status_SUSPENDED");
      case "APPLIED": return t("um_status_APPLIED");
      case "UNDER_REVIEW": return t("um_status_UNDER_REVIEW");
      case "APPROVED": return t("um_status_APPROVED");
      case "CREATED": return t("um_status_CREATED");
      case "VERIFIED": return t("um_status_VERIFIED");
      default: return s;
    }
  };

  let result: { items: unknown[]; page: number; totalPages: number; totalCount: number };
  let rows: RowVM[];
  try {
    if (tab === "administrators") {
      const r = await getAdmins({ q, status: status as AdminStatus | undefined, page });
      result = r;
      rows = r.items.map((a) => ({ key: a.id, primary: a.phoneNumber, secondary: `ID ${a.userId}`, status: a.status, meta: [dateFmt(a.createdAt)] }));
    } else if (tab === "staff") {
      const r = await getStaff({ q, status: status as StaffStatus | undefined, page });
      result = r;
      rows = r.items.map((s) => ({
        key: s.id,
        primary: s.phoneNumber,
        secondary: s.roles.length ? s.roles.join(" · ") : t("um_noRoles"),
        status: s.status,
        meta: [dateFmt(s.createdAt)],
      }));
    } else if (tab === "providers") {
      const r = await getProviders({ q, status: status as ProviderStatus | undefined, page });
      result = r;
      rows = r.items.map((p) => ({
        key: p.id,
        primary: p.businessName,
        secondary: p.phoneNumber,
        status: p.status,
        meta: [p.city ?? "", dateFmt(p.createdAt)].filter(Boolean),
      }));
    } else {
      const r = await getCustomers({ q, status: status as UserStatus | undefined, page });
      result = r;
      rows = r.items.map((c) => ({
        key: c.id,
        primary: c.phoneNumber,
        secondary: `ID ${c.userId}`,
        status: c.status,
        meta: [t("customerBookingCountLabel", { count: c.bookingCount }), t("customerReviewCountLabel", { count: c.reviewCount }), dateFmt(c.createdAt)],
      }));
    }
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

  const hasActiveFilter = Boolean(q || status);
  const isOutOfRangePage = result.totalCount > 0 && rows.length === 0 && page > 1;
  const basePath = getPathname({ href: "/admin/users", locale });
  const searchPlaceholder = tab === "providers" ? t("um_searchPlaceholderProvider") : t("um_searchPlaceholderPhoneId");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("um_title")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("um_description")}</p>
      </div>

      {/* Tabs — switching tabs resets search/filter/page */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((tabKey) => (
          <Link
            key={tabKey}
            href={`/admin/users?tab=${tabKey}`}
            role="tab"
            aria-selected={tab === tabKey}
            className={
              tab === tabKey
                ? "rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground"
                : "rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/10"
            }
          >
            {t(`um_tab_${tabKey}`)}
          </Link>
        ))}
      </div>

      {/* Search + status filter (GET form, preserves the active tab) */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-sm"
      >
        <input type="hidden" name="tab" value={tab} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label={t("um_allStatuses")}
          className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none"
        >
          <option value="">{t("um_allStatuses")}</option>
          {STATUSES_BY_TAB[tab].map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("um_search")}
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          message={isOutOfRangePage ? t("um_emptyPage") : hasActiveFilter ? t("um_emptyMatch") : t("um_empty")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-start font-medium text-foreground">{row.primary}</p>
                {row.secondary ? <p dir="ltr" className="mt-0.5 truncate text-start text-xs text-foreground/40">{row.secondary}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                {row.meta.map((m, i) => (
                  <span key={i} className="text-xs text-foreground/60">{m}</span>
                ))}
                <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={basePath} />
    </div>
  );
}
