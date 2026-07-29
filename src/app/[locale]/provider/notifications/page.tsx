import { notFound } from "next/navigation";
import { BellOff, Check, CheckCheck } from "lucide-react";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications/get-notifications";
import { markNotificationRead } from "@/lib/notifications/mark-notification-read";
import { markAllNotificationsRead } from "@/lib/notifications/mark-all-notifications-read";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getPathname } from "@/i18n/navigation";
import { formatDate } from "@/lib/i18n/format-date";
import { groupNotificationsByDate } from "@/lib/notifications/group-notifications-by-date";
import { getNotificationPresentation } from "@/components/notifications/notification-presentation";

// Phase F.3 (Provider Notifications: "Grouping... Icons... Visual
// hierarchy") — grouped by the notification's own real createdAt date
// (same grouping technique as the Availability page's date sections).
//
// Phase F.4: groupByDate() extracted to
// src/lib/notifications/group-notifications-by-date.ts so the Customer
// notifications page can reuse the exact same grouping instead of
// duplicating it (see that page's own Phase F.4 comment).
//
// Provider Notifications & Operational Alerts phase: the icon here
// used to be a binary `causingBookingId ? CalendarCheck : Bell` guess,
// duplicated verbatim in the Customer page below and absent entirely
// from NotificationBell. Replaced with getNotificationPresentation()
// (src/components/notifications/notification-presentation.ts), one
// shared per-kind icon/badge mapping with a safe generic fallback for
// unknown or historical (pre-phase) rows — see that module's own
// comment for the full rationale.

// Notification Center — Provider surface — Phase D.1 (Notifications &
// Messaging Implementation).
//
// This route lives under /provider/*, gated by
// src/app/[locale]/provider/layout.tsx's own requireProvider() check
// exactly like every other Provider page — a non-Provider hitting this
// URL gets the same notFound() treatment as any other /provider/*
// route, per the existing "do not expose the Provider Dashboard's
// existence" policy. getNotifications() itself is role-agnostic (see
// its own file header) — only the route's gating and AppShell
// wrapping are Provider-specific, supplied entirely by the layout.
//
// SAME UNCAUGHT-EXCEPTION LESSON ALREADY LEARNED (Phase C.3 Group 2):
// getNotifications() calls requireAuth() internally as its own
// independent re-check (defense in depth, on top of the layout's own
// requireProvider() check) — caught here with the exact same
// try/catch pattern already applied to every other Provider page.
//
// SHARED MARKUP WITH THE CUSTOMER PAGE, DELIBERATELY NOT EXTRACTED:
// the list/empty-state/pagination JSX below is intentionally
// byte-similar to src/app/[locale]/notifications/page.tsx rather than
// factored into a shared component, since the two pages differ in
// their AppShell wrapping and translator source in a way that would
// make a shared component take more props than it saves lines — the
// same judgment call already made for Customer vs Provider list pages
// elsewhere in this codebase (e.g. bookings vs provider/bookings).

type SearchParams = { page?: string };

export default async function ProviderNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  const t = await getServerTranslator("notifications");

  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getNotifications({ page });
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

  if (result.totalCount > 0 && result.items.length === 0 && page !== 1) {
    notFound();
  }

  const hasUnread = result.items.some((item) => !item.isRead);
  const notificationsPath = getPathname({ href: "/provider/notifications", locale });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t("pageTitle")}</h1>
        {hasUnread && (
          <form
            action={async () => {
              "use server";
              await markAllNotificationsRead();
            }}
          >
            <SubmitButton className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50">
              <CheckCheck size={16} strokeWidth={1.75} />
              {t("markAllReadButton")}
            </SubmitButton>
          </form>
        )}
      </div>

      {result.totalCount === 0 ? (
        <EmptyState icon={BellOff} iconSize={32} gap="gap-3" padding="py-16" message={t("emptyStateLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={BellOff} iconSize={32} gap="gap-3" padding="py-16" message={t("noNotificationsOnPageLabel")} />
      ) : (
        <div className="flex flex-col gap-6">
          {groupNotificationsByDate(result.items, locale).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/40">{dateLabel}</h2>
              <ul className="flex flex-col gap-3">
                {items.map((item) => {
                  const { Icon, badgeVariant, categoryKey } = getNotificationPresentation(item.kind);
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm ${
                        item.isRead ? "border-border bg-card" : "border-primary/30 bg-accent/10"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            item.isRead ? "bg-accent/15 text-foreground/40" : "bg-primary/10 text-primary"
                          }`}
                        >
                          <Icon size={15} strokeWidth={1.75} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`text-sm ${item.isRead ? "text-foreground/60" : "font-medium text-foreground"}`}>
                              {item.message}
                            </p>
                            <Badge variant={badgeVariant}>{t(categoryKey)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-foreground/40">
                            {formatDate(new Date(item.createdAt), locale, { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>

                      {!item.isRead && (
                        <form
                          action={async () => {
                            "use server";
                            await markNotificationRead(item.id);
                          }}
                        >
                          <SubmitButton
                            aria-label={`${t("markReadAriaLabel")}: ${item.message}`}
                            className="flex shrink-0 items-center gap-1.5 rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Check size={16} strokeWidth={1.75} />
                          </SubmitButton>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={notificationsPath} />
    </div>
  );
}
