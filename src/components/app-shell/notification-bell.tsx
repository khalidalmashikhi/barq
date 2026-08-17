"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { markNotificationRead } from "@/lib/notifications/mark-notification-read";
import { markAllNotificationsRead } from "@/lib/notifications/mark-all-notifications-read";
import type { NotificationListItem } from "@/lib/notifications/get-notifications";
import { getNotificationPresentation } from "@/components/notifications/notification-presentation";
import { NotificationActionLink } from "@/components/notifications/notification-action-link";

// Notification bell + dropdown — Phase D.1 (Notifications & Messaging
// Implementation).
//
// REPLACES the fully decorative bell button removed in Phase C.3
// Group 5 (a hardcoded, always-on "unread" dot with no real data
// behind it) — this one renders the real unread count, fetched
// server-side by AppTopBar and passed in as initial props, since a
// Client Component cannot import server-only query modules directly.
//
// OPTIMISTIC LOCAL STATE, NOT A FULL REFRESH: mark-one/mark-all update
// this component's own local state immediately so the badge and list
// reflect the change on the current page without a hard reload. The
// underlying Server Actions also revalidatePath() the dedicated
// notifications pages, so a subsequent navigation there (or a fresh
// page load anywhere, since AppTopBar re-fetches server-side on every
// render) is always consistent with the database regardless of what
// this component's local state shows in between.
//
// NO NAVIGATION ON ITEM CLICK, DELIBERATELY: clicking an unread item
// marks it read in place. It does not also navigate to
// causingBookingId, since Customer and Provider bookings have
// different (or, for Provider, no per-booking detail) destinations —
// inventing one here would be a real, unclear product decision this
// phase's scope does not cover. "View All" is the one, unambiguous
// navigation affordance, per this phase's own explicit UI list.
//
// Provider Notifications & Operational Alerts phase: each row now
// shows a real per-kind icon via getNotificationPresentation()
// (src/components/notifications/notification-presentation.ts, shared
// with both full Notification Center pages) in place of the plain
// unread dot — everything else about this dropdown is unchanged.
//
// KEYBOARD/ARIA: the trigger is a real <button> with
// aria-haspopup/aria-expanded; the panel is role="menu" with
// role="menuitem" entries; Escape closes and returns focus to the
// trigger; a document-level mousedown listener closes on outside
// click. Tab/Shift+Tab move through the panel's real, focusable
// buttons/link in natural DOM order — no custom roving-tabindex is
// implemented, since a native tab order already satisfies this
// phase's "keyboard navigation" requirement without the added
// complexity/risk of a hand-rolled arrow-key focus manager.

type NotificationBellProps = {
  initialUnreadCount: number;
  initialItems: NotificationListItem[];
  viewAllHref: string;
};

export function NotificationBell({ initialUnreadCount, initialItems, viewAllHref }: NotificationBellProps) {
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [items, setItems] = useState(initialItems);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleMarkOneRead(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      await markNotificationRead(id);
    } catch {
      // Best-effort optimistic UI: a failed request leaves the local
      // state slightly ahead of the database until the next real page
      // load re-fetches it server-side (see file header) — no visible
      // error surfaced for a background read-state update.
    }
  }

  async function handleMarkAllRead() {
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      // Same best-effort rationale as handleMarkOneRead above.
    }
  }

  const bellAriaLabel =
    unreadCount > 0 ? t("unreadBadgeAriaLabel", { count: unreadCount }) : tCommon("notificationsAriaLabel");

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="relative rounded-full p-2 text-foreground/60 transition-colors hover:bg-accent/20 hover:text-foreground"
        aria-label={bellAriaLabel}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Bell size={18} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-semibold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t("pageTitle")}
          className="absolute end-0 top-full z-20 mt-2 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl border border-border bg-card p-2 shadow-premium-lg sm:w-80"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-sm font-semibold text-foreground">{t("pageTitle")}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary hover:bg-accent/20"
              >
                <CheckCheck size={14} strokeWidth={1.75} />
                {t("markAllReadButton")}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-foreground/50">{t("emptyStateLabel")}</p>
          ) : (
            <ul className="mt-1 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {items.map((item) => {
                const { Icon } = getNotificationPresentation(item.kind);
                // CTA is a navigation <Link>, so it must be a SIBLING of the
                // mark-read <button> (never nested inside it). onActivate marks an
                // unread row read + closes the panel; navigation never waits on it.
                const cta = (
                  <NotificationActionLink
                    eventType={item.eventType}
                    entityType={item.entityType}
                    entityId={item.entityId}
                    onActivate={() => {
                      if (!item.isRead) handleMarkOneRead(item.id);
                      setIsOpen(false);
                    }}
                  />
                );
                return (
                  <li key={item.id} role="none" className="rounded-xl hover:bg-accent/15">
                    <div className="flex items-start gap-2 px-2 py-2">
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        className={`mt-0.5 shrink-0 ${item.isRead ? "text-foreground/30" : "text-primary"}`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {item.isRead ? (
                          <span role="menuitem" className="text-sm text-foreground/50">
                            {item.message}
                          </span>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleMarkOneRead(item.id)}
                            aria-label={`${t("markReadAriaLabel")}: ${item.message}`}
                            className="flex items-start gap-2 text-start text-sm font-medium text-foreground"
                          >
                            <span className="flex-1">{item.message}</span>
                            <Check size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-foreground/30" />
                          </button>
                        )}
                        {cta}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            href={viewAllHref}
            onClick={() => setIsOpen(false)}
            className="mt-1 block rounded-xl px-2 py-2 text-center text-sm font-medium text-primary hover:bg-accent/15"
          >
            {t("viewAllLabel")}
          </Link>
        </div>
      )}
    </div>
  );
}
