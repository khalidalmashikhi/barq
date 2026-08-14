import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { Locale } from "@/i18n/locales";

// Notification list query — Phase D.1 (Notifications & Messaging
// Implementation).
//
// OWNERSHIP: scoped entirely to the authenticated user's own userId,
// resolved server-side via requireAuth() — never trusts a client-
// supplied identity, matching the same pattern already established by
// getMyBookings()/getBookingDetail().
//
// NEWEST FIRST, DETERMINISTIC PAGINATION: same compound (createdAt
// desc, id desc) ordering already used by get-my-bookings.ts —
// createdAt alone is not guaranteed unique; the UUID v7 id is itself
// time-ordered (ADR-0006) and a safe tie-breaker.
//
// NO JOIN, NO N+1: content is inline Json on the Notification row
// itself — this is a single query for the page plus one count query,
// run in parallel, exactly like get-my-bookings.ts's own shape.
//
// ROLE-AGNOSTIC BY DESIGN: Notification.userId references the base
// User, not Customer/Provider specifically (per the existing schema),
// so this query works unchanged for both the Customer notifications
// page and the Provider notifications page — only the page/route
// wrapping differs, not the underlying business logic.

export type NotificationListItem = {
  id: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  causingBookingId: string | null;
  /// Provider Notifications & Operational Alerts phase — the writer-
  /// side kind (see src/lib/booking/lifecycle/notify.ts), read back out
  /// of this same Json content column (no dedicated Prisma column
  /// exists). undefined for rows written before this phase, or for any
  /// notification written by a different module (e.g. contract
  /// execution's own notify.ts, which does not embed a kind) — callers
  /// must treat this as optional and fall back safely, never assume
  /// presence.
  kind: string | undefined;
};

export type GetNotificationsParams = {
  page?: number;
  pageSize?: number;
};

export type GetNotificationsResult = {
  items: NotificationListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

function extractNotificationKind(content: unknown): string | undefined {
  if (!content || typeof content !== "object") return undefined;
  const kind = (content as Record<string, unknown>).kind;
  return typeof kind === "string" ? kind : undefined;
}

// `localeOverride` (additive, optional): the authenticated /api/v1 adapter passes
// an explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getNotifications(
  params: GetNotificationsParams = {},
  localeOverride?: Locale
): Promise<GetNotificationsResult> {
  const { barqUser } = await requireAuth();
  const locale = localeOverride ?? (await getLocale());

  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const [totalCount, notifications] = await Promise.all([
    prisma.notification.count({ where: { userId: barqUser.id } }),
    prisma.notification.findMany({
      where: { userId: barqUser.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  type NotificationRow = {
    id: string;
    content: unknown;
    readAt: Date | null;
    createdAt: Date;
    causingBookingId: string | null;
  };

  const items: NotificationListItem[] = (notifications as NotificationRow[]).map((notification) => ({
    id: notification.id,
    message: extractLocalizedText(notification.content, locale),
    isRead: notification.readAt !== null,
    createdAt: notification.createdAt,
    causingBookingId: notification.causingBookingId,
    kind: extractNotificationKind(notification.content),
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
