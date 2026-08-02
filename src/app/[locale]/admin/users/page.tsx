import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect, getPathname } from "@/i18n/navigation";
import { ShieldCheck, UserPlus } from "lucide-react";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAdmins, type AdminListItem } from "@/lib/admin/get-admins";
import { getStaff } from "@/lib/admin/get-staff";
import { getProviders } from "@/lib/admin/get-providers";
import { getCustomers } from "@/lib/admin/get-customers";
import { addAdmin } from "@/lib/admin/add-admin";
import { activateAdmin } from "@/lib/admin/activate-admin";
import { deactivateAdmin } from "@/lib/admin/deactivate-admin";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import type { AdminStatus, StaffStatus, ProviderStatus, UserStatus } from "@prisma/client";

// Admin → User & Access Management. Batch 2 added the read-only four-tab list;
// Batch 3 adds administrator lifecycle actions on the Administrators tab
// (Add / Activate / Deactivate), following the existing inline-server-action +
// SubmitButton + ?notice=/?error= result pattern used by admin/providers.
// No mutations on the other tabs yet; no hard-delete anywhere.

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

const NOTICE_CODES = ["granted", "reactivated", "already_active", "activated", "deactivated", "already_deactivated"] as const;
const ERROR_CODES = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "USER_NOT_FOUND",
  "USER_NOT_VERIFIED",
  "USER_INACTIVE",
  "ADMIN_NOT_FOUND",
  "LAST_ACTIVE_ADMIN",
  "UNKNOWN_ERROR",
] as const;

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
      return "info";
  }
}

type RowVM = { key: string; primary: string; secondary?: string; status: string; meta: string[] };

type SearchParams = { tab?: string; q?: string; status?: string; page?: string; notice?: string; error?: string };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "administrators";
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
  const q = params.q?.trim() || undefined;
  const status = params.status && STATUSES_BY_TAB[tab].includes(params.status) ? params.status : undefined;

  const dateFmt = (d: Date) => formatDate(d, locale, { day: "numeric", month: "short", year: "numeric" });

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

  const noticeMessage = (code: string): string => {
    switch (code) {
      case "granted": return t("um_notice_granted");
      case "reactivated": return t("um_notice_reactivated");
      case "already_active": return t("um_notice_already_active");
      case "activated": return t("um_notice_activated");
      case "deactivated": return t("um_notice_deactivated");
      case "already_deactivated": return t("um_notice_already_deactivated");
      default: return "";
    }
  };

  const errorMessage = (code: string): string => {
    switch (code) {
      case "INVALID_INPUT": return t("um_error_INVALID_INPUT");
      case "NO_ADMIN_PROFILE": return t("um_error_NO_ADMIN_PROFILE");
      case "USER_NOT_FOUND": return t("um_error_USER_NOT_FOUND");
      case "USER_NOT_VERIFIED": return t("um_error_USER_NOT_VERIFIED");
      case "USER_INACTIVE": return t("um_error_USER_INACTIVE");
      case "ADMIN_NOT_FOUND": return t("um_error_ADMIN_NOT_FOUND");
      case "LAST_ACTIVE_ADMIN": return t("um_error_LAST_ACTIVE_ADMIN");
      default: return t("um_error_UNKNOWN_ERROR");
    }
  };

  let result: { items: unknown[]; page: number; totalPages: number; totalCount: number };
  let rows: RowVM[] = [];
  let adminItems: AdminListItem[] | null = null;
  let currentAdminId: string | null = null;
  try {
    if (tab === "administrators") {
      const [auth, r] = await Promise.all([requireAdmin(), getAdmins({ q, status: status as AdminStatus | undefined, page })]);
      currentAdminId = auth.admin.id;
      result = r;
      adminItems = r.items;
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
  const listCount = tab === "administrators" ? (adminItems?.length ?? 0) : rows.length;
  const isOutOfRangePage = result.totalCount > 0 && listCount === 0 && page > 1;
  const basePath = getPathname({ href: "/admin/users", locale });
  const searchPlaceholder = tab === "providers" ? t("um_searchPlaceholderProvider") : t("um_searchPlaceholderPhoneId");
  const emptyMessage = isOutOfRangePage ? t("um_emptyPage") : hasActiveFilter ? t("um_emptyMatch") : t("um_empty");

  const notice = params.notice && (NOTICE_CODES as readonly string[]).includes(params.notice) ? noticeMessage(params.notice) : null;
  const errorMsg = params.error && (ERROR_CODES as readonly string[]).includes(params.error) ? errorMessage(params.error) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("um_title")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("um_description")}</p>
      </div>

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

      {notice && <Alert variant="success">{notice}</Alert>}
      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {/* Add Administrator — Administrators tab only */}
      {tab === "administrators" && (
        <form
          action={async (formData: FormData) => {
            "use server";
            const phone = String(formData.get("phone") ?? "");
            const r = await addAdmin(phone);
            redirect({
              href: r.ok ? `/admin/users?tab=administrators&notice=${r.outcome}` : `/admin/users?tab=administrators&error=${r.error}`,
              locale,
            });
          }}
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
        >
          <UserPlus size={18} strokeWidth={1.75} className="shrink-0 text-foreground/50" aria-hidden />
          <input
            type="tel"
            name="phone"
            required
            dir="ltr"
            placeholder={t("um_addAdminPlaceholder")}
            aria-label={t("um_addAdminTitle")}
            className="min-w-0 flex-1 bg-transparent text-start text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
          <SubmitButton className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {t("um_addAdminButton")}
          </SubmitButton>
        </form>
      )}

      {/* Search + status filter */}
      <form method="get" className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-sm">
        <input type="hidden" name="tab" value={tab} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <select name="status" defaultValue={status ?? ""} aria-label={t("um_allStatuses")} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none">
          <option value="">{t("um_allStatuses")}</option>
          {STATUSES_BY_TAB[tab].map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("um_search")}
        </button>
      </form>

      {tab === "administrators" ? (
        (adminItems?.length ?? 0) === 0 ? (
          <EmptyState icon={ShieldCheck} message={emptyMessage} />
        ) : (
          <div className="flex flex-col gap-3">
            {adminItems!.map((admin) => (
              <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p dir="ltr" className="truncate text-start font-medium text-foreground">{admin.phoneNumber}</p>
                  <p dir="ltr" className="mt-0.5 truncate text-start text-xs text-foreground/40">ID {admin.userId} · {dateFmt(admin.createdAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {admin.id === currentAdminId && <Badge variant="info">{t("um_youLabel")}</Badge>}
                  <Badge variant={statusVariant(admin.status)}>{statusLabel(admin.status)}</Badge>
                  {admin.status === "DEACTIVATED" ? (
                    <form
                      action={async () => {
                        "use server";
                        const r = await activateAdmin(admin.id);
                        redirect({ href: r.ok ? `/admin/users?tab=administrators&notice=${r.outcome}` : `/admin/users?tab=administrators&error=${r.error}`, locale });
                      }}
                    >
                      <SubmitButton className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                        {t("um_activateButton")}
                      </SubmitButton>
                    </form>
                  ) : (
                    <form
                      action={async () => {
                        "use server";
                        const r = await deactivateAdmin(admin.id);
                        redirect({ href: r.ok ? `/admin/users?tab=administrators&notice=${r.outcome}` : `/admin/users?tab=administrators&error=${r.error}`, locale });
                      }}
                    >
                      <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                        {t("um_deactivateButton")}
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} message={emptyMessage} />
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
