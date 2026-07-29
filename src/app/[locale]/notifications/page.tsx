import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BellOff, Check, CheckCheck } from "lucide-react";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications/get-notifications";
import { markNotificationRead } from "@/lib/notifications/mark-notification-read";
import { markAllNotificationsRead } from "@/lib/notifications/mark-all-notifications-read";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getPathname } from "@/i18n/navigation";
import { formatDate } from "@/lib/i18n/format-date";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { groupNotificationsByDate } from "@/lib/notifications/group-notifications-by-date";
import { getNotificationPresentation } from "@/components/notifications/notification-presentation";

// Notification Center — Customer surface — Phase D.1 (Notifications &
// Messaging Implementation).
//
// SAME MISSING-APPSHELL LESSON ALREADY LEARNED (Phase C.3 Group 3):
// this is a brand-new route, so it is wrapped in AppShell from the
// start via the shared getCustomerNavItems() helper — never built bare
// the way /bookings originally was.
//
// SAME UNCAUGHT-EXCEPTION LESSON ALREADY LEARNED (Phase C.3 Group 2):
// getNotifications() calls requireAuth() internally, which throws
// UnauthenticatedError rather than returning an empty result — caught
// here with the exact same redirect pattern already used throughout
// this codebase, not a new one invented for this page.
//
// ROLE-AGNOSTIC QUERY, ROLE-SPECIFIC PAGE: getNotifications()/
// markNotificationRead()/markAllNotificationsRead() are shared,
// unchanged, with the Provider notifications page
// (src/app/[locale]/provider/notifications/page.tsx) — only the
// AppShell wrapping differs here, per the existing flat-per-role route
// convention (Customer routes are top-level; Provider routes nest
// under provider/layout.tsx's own AppShell).
//
// Phase F.4 (goal 10, Notification Experience): date-grouping was
// built for the Provider page in Phase F.3 but never brought over here
// — this page rendered a flat list with no grouping until now. Both
// pages now share groupNotificationsByDate() (src/lib/notifications/
// group-notifications-by-date.ts) instead of the Provider page's
// version being copy-pasted a second time.
//
// Provider Notifications & Operational Alerts phase: the per-item icon
// now comes from the same shared getNotificationPresentation()
// (src/components/notifications/notification-presentation.ts) the
// Provider page uses — see that module's comment for why the old
// `causingBookingId ? CalendarCheck : Bell` guess was replaced.
//
// MARK-ONE/MARK-ALL AS PLAIN FORMS, NOT CLIENT JS: both Server Actions
// already revalidatePath() themselves, and Next.js's own progressive
// enhancement re-renders this Server Component after either submits —
// no client-side state needed on this page (unlike the topbar
// dropdown, which needs to feel instant without a full navigation).

type SearchParams = { page?: string };

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NotificationsPage({
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
    throw error;
  }

  if (result.totalCount > 0 && result.items.length === 0 && page !== 1) {
    notFound();
  }

  const hasUnread = result.items.some((item) => !item.isRead);
  const notificationsPath = getPathname({ href: "/notifications", locale });
  const tDashboard = await getServerTranslator("dashboard");
  const unreadNotificationsCount = await getUnreadCount();

  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
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
    </AppShell>
  );
}
