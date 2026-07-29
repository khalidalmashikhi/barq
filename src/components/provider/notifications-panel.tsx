import { Bell, Sparkles } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getNotificationPresentation } from "@/components/notifications/notification-presentation";
import type { NotificationListItem } from "@/lib/notifications/get-notifications";

// Dashboard Alerts area — Provider Notifications & Operational Alerts
// phase. Deliberately narrow: unread count + a short recent-
// notifications list only. Reuses getNotifications()/getUnreadCount()
// (no new query, no duplicated aggregation) and the same
// getNotificationPresentation() mapping the Notification Center pages
// use, so an icon/badge means the same thing everywhere it appears.
//
// WHY THIS DOES NOT ALSO SHOW "Upcoming bookings today": that data
// (data.todaysBookings) is already a full, first-class dashboard
// section via <BookingPreviewList> above this one on the page —
// repeating it here would be exactly the duplicate card the phase's
// own "avoid duplicate cards" instruction rules out. Same reasoning
// for ServiceInsights/CapacityAlerts, both already rendered elsewhere
// on this page.

type NotificationsPanelProps = {
  unreadCount: number;
  items: NotificationListItem[];
  viewAllHref: string;
  /// Set only when isHighRatedMilestone() (get-provider-reviews-summary.ts)
  /// is true — see that function's own comment for the approved
  /// threshold and its AskUserQuestion provenance. undefined renders no
  /// banner at all, rather than a "0 reviews" placeholder.
  highRatedMilestone?: { averageRating: number; reviewCount: number };
};

export async function NotificationsPanel({ unreadCount, items, viewAllHref, highRatedMilestone }: NotificationsPanelProps) {
  const t = await getServerTranslator("notifications");
  const tProvider = await getServerTranslator("provider");

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/60">
          <Bell size={16} strokeWidth={1.75} />
          {t("pageTitle")}
        </h2>
        {unreadCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.7rem] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </div>

      {highRatedMilestone && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <Sparkles size={16} strokeWidth={1.75} className="shrink-0" />
          <span>
            {tProvider("highRatedMilestoneLabel", {
              rating: highRatedMilestone.averageRating.toFixed(1),
              count: highRatedMilestone.reviewCount,
            })}
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={Bell} iconSize={24} gap="gap-2" padding="py-6" message={t("emptyStateLabel")} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const { Icon, badgeVariant, categoryKey } = getNotificationPresentation(item.kind);
            return (
              <li key={item.id} className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    item.isRead ? "bg-accent/15 text-foreground/40" : "bg-primary/10 text-primary"
                  }`}
                >
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className={item.isRead ? "text-foreground/60" : "font-medium text-foreground"}>{item.message}</p>
                    <Badge variant={badgeVariant}>{t(categoryKey)}</Badge>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href={viewAllHref}
        className="mt-3 block rounded text-center text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {tProvider("viewAllLabel")}
      </Link>
    </div>
  );
}
