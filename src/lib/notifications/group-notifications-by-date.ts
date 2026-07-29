import type { Locale } from "next-intl";
import { formatDate } from "@/lib/i18n/format-date";
import type { NotificationListItem } from "./get-notifications";

// Extracted in Phase F.4 (goal 10, Notification Experience): the
// Provider notifications page built this grouping in Phase F.3; the
// Customer notifications page never got the same treatment, so this
// was duplicated logic waiting to diverge rather than a shared helper
// — moved here so both pages group by the same real createdAt date.

export function groupNotificationsByDate(
  items: NotificationListItem[],
  locale: Locale,
): Array<[string, NotificationListItem[]]> {
  const groups = new Map<string, NotificationListItem[]>();
  for (const item of items) {
    const key = formatDate(new Date(item.createdAt), locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return Array.from(groups.entries());
}
