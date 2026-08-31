import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { STALE_CLAIM_MS } from "@/lib/notifications/email/deliver-booking-emails";
import type { EmailDeliveryStatus } from "@prisma/client";

// BOOKING OPS OBSERVABILITY — the read-only admin view of the BookingEmailDelivery outbox. Lets an
// operator answer: did BARQ enqueue the email, for which booking event, is it pending/processing/
// sent/failed/skipped, how many attempts, when last attempted/sent, why it failed (sanitized class),
// and which booking it belongs to. requireAdmin()-gated; NO email body, address, or secret is stored
// on the row (the recipient email is resolved at send time and never persisted) so none can leak.
// Read-only: this NEVER mutates a delivery, sends anything, or writes an audit event.

export type BookingEmailDeliveryStatus = EmailDeliveryStatus;

export type BookingEmailDeliveryListItem = {
  id: string;
  bookingId: string;
  /// The recipient's domain User.id — an internal correlation id only (NEVER an email address,
  /// which is never stored on this row). Safe to show to an admin for internal correlation.
  recipientUserId: string;
  /// The BookingNotificationKind (e.g. "BOOKING_ACCEPTED") — a stable machine event name.
  kind: string;
  status: BookingEmailDeliveryStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  /// The already-sanitized failure class/code (e.g. "HTTP_500", "NETWORK", "DISABLED") — never PII,
  /// a response body, an address, or a secret. Rendered verbatim.
  lastError: string | null;
  createdAt: Date;
  /// PROCESSING rows whose claim is older than the worker's stale window (STALE_CLAIM_MS) are
  /// reclaimable — i.e. a crashed worker likely abandoned them. Surfaced so an operator can tell a
  /// stuck claim from a normal in-flight one. Read-only signal; no manual unlock in this gate.
  stale: boolean;
};

export type GetBookingEmailDeliveriesFilters = {
  status?: BookingEmailDeliveryStatus;
  page?: number;
  pageSize?: number;
};

export type GetBookingEmailDeliveriesResult = {
  items: BookingEmailDeliveryListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getBookingEmailDeliveries(
  filters: GetBookingEmailDeliveriesFilters = {},
): Promise<GetBookingEmailDeliveriesResult> {
  await requireAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where = filters.status ? { status: filters.status } : {};

  const [totalCount, rows] = await Promise.all([
    prisma.bookingEmailDelivery.count({ where }),
    prisma.bookingEmailDelivery.findMany({
      where,
      // Newest activity first (served by the @@index([status, createdAt]) when a status is filtered).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        bookingId: true,
        recipientUserId: true,
        kind: true,
        status: true,
        attemptCount: true,
        lastAttemptAt: true,
        sentAt: true,
        lastError: true,
        createdAt: true,
      },
    }),
  ]);

  const staleBefore = Date.now() - STALE_CLAIM_MS;

  const items: BookingEmailDeliveryListItem[] = rows.map((row) => ({
    id: row.id,
    bookingId: row.bookingId,
    recipientUserId: row.recipientUserId,
    kind: row.kind,
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    sentAt: row.sentAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    stale: row.status === "PROCESSING" && row.lastAttemptAt !== null && row.lastAttemptAt.getTime() < staleBefore,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
