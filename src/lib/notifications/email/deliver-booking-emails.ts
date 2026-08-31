import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { formatDate } from "@/lib/i18n/format-date";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { bookingMoneyViewFromRow, formatBookingTotal } from "@/lib/booking/pricing/booking-money-view";
import { isBookingEmailEnabled } from "./booking-email-config";
import { sendBookingEmail } from "./send-booking-email";
import { buildBookingEmail, isBookingEmailKind } from "./booking-email-content";
import { bookingEmailAudience } from "./booking-email-policy";
import { resolveRecipientVerifiedEmail, resolveRecipientLocale } from "./resolve-recipient";

// BOOKING NOTIFICATION DELIVERY — the delivery worker (driven by the CRON_SECRET-protected cron).
// This is the ONLY place the external Resend send happens — never inside a booking transaction,
// never in the request path (§8). Bounded retry (§11), guarded single-claim concurrency (§12), and
// stale-claim recovery so a crashed worker never strands a row (§2).

export const MAX_DELIVERY_ATTEMPTS = 5;
// A PROCESSING row untouched for longer than this is assumed abandoned by a crashed worker and is
// reclaimable. Comfortably longer than a healthy send.
export const STALE_CLAIM_MS = 10 * 60 * 1000;
const DEFAULT_BATCH = 25;

// Totals are meaningful only where the booking is going ahead — include them on the new-request and
// confirmation emails, omit on rejected/cancelled/expired (the booking won't happen).
const KINDS_WITH_TOTAL = new Set(["PENDING_PROVIDER", "BOOKING_ACCEPTED"]);

export type DeliveryRunSummary = {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
};

/**
 * Attempt delivery of the pending/failed-transient/stale-claimed booking emails. No-ops (enabled:
 * false) when booking email is disabled, so a disabled staging never burns attempts. Safe to run
 * concurrently: each row is claimed with a guarded update before any send.
 */
export async function deliverPendingBookingEmails(opts?: { batchSize?: number }): Promise<DeliveryRunSummary> {
  const summary: DeliveryRunSummary = { enabled: true, claimed: 0, sent: 0, failed: 0, skipped: 0, retried: 0 };

  if (!isBookingEmailEnabled()) {
    return { ...summary, enabled: false };
  }

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH;

  // Candidates: freshly PENDING, or a PROCESSING row abandoned past the stale window. FAILED and
  // SKIPPED are terminal and never re-selected; a transient failure returns the row to PENDING.
  const candidates = await prisma.bookingEmailDelivery.findMany({
    where: {
      OR: [{ status: "PENDING" }, { status: "PROCESSING", lastAttemptAt: { lt: staleCutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true, status: true, attemptCount: true },
  });

  for (const candidate of candidates) {
    // Guarded claim: only the worker whose WHERE still matches (same status AND attemptCount) wins;
    // a competing worker's identical update then matches 0 rows and it skips. This is the single-
    // claim guarantee — DB-level, not exactly-once across the external Resend boundary.
    const claim = await prisma.bookingEmailDelivery.updateMany({
      where: { id: candidate.id, status: candidate.status, attemptCount: candidate.attemptCount },
      data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    if (claim.count === 0) continue; // another worker claimed it

    summary.claimed += 1;
    const attemptCountAfterClaim = candidate.attemptCount + 1;
    const outcome = await deliverClaimedRow(candidate.id, attemptCountAfterClaim, now);
    summary[outcome] += 1;
  }

  return summary;
}

type RowOutcome = "sent" | "failed" | "skipped" | "retried";

async function deliverClaimedRow(deliveryId: string, attemptCount: number, now: Date): Promise<RowOutcome> {
  const delivery = await prisma.bookingEmailDelivery.findUnique({
    where: { id: deliveryId },
    select: { kind: true, bookingId: true, recipientUserId: true },
  });
  if (!delivery) return "failed";

  const { kind, bookingId, recipientUserId } = delivery;

  // A stored kind that isn't renderable should be impossible (only eligible kinds are enqueued);
  // fail terminally rather than loop.
  if (!isBookingEmailKind(kind)) {
    await markTerminal(deliveryId, "FAILED", "UNRENDERABLE_KIND", now);
    return "failed";
  }

  const email = await resolveRecipientVerifiedEmail(prisma, recipientUserId);
  if (email === null) {
    // No genuinely verified, non-synthetic email (or an inactive/merged identity) → never send.
    await markTerminal(deliveryId, "SKIPPED", null, now);
    return "skipped";
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      service: { select: { name: true } },
      availability: { select: { startTime: true } },
      priceSnapshotAmount: true,
      priceSnapshotCurrency: true,
      pricingUnitSnapshot: true,
      billableQuantitySnapshot: true,
      bookingTotalSnapshot: true,
    },
  });
  if (!booking) {
    await markTerminal(deliveryId, "FAILED", "NO_BOOKING", now);
    return "failed";
  }

  const locale = await resolveRecipientLocale(prisma, recipientUserId);
  const audience = bookingEmailAudience(kind) ?? "CUSTOMER";
  const path = audience === "PROVIDER" ? `/provider/bookings/${bookingId}` : `/bookings/${bookingId}`;

  const serviceName = extractLocalizedText(booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience");
  const whenText = booking.availability?.startTime
    ? formatDate(booking.availability.startTime, locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const totalText = KINDS_WITH_TOTAL.has(kind) ? formatBookingTotal(bookingMoneyViewFromRow(booking)) : null;

  const content = buildBookingEmail({
    kind,
    locale,
    facts: { serviceName, bookingUrl: buildPublicUrl(locale, path), whenText, totalText },
  });

  const result = await sendBookingEmail({ to: email, subject: content.subject, html: content.html, text: content.text });

  if (result.ok) {
    await prisma.bookingEmailDelivery.update({
      where: { id: deliveryId },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
    logger.info("bookingEmail.sent", { deliveryId, bookingId, kind, attemptCount });
    return "sent";
  }

  // A permanent rejection is terminal; a transient failure returns to PENDING until the retry
  // budget is exhausted, at which point it becomes terminally FAILED.
  const exhausted = !result.retryable || attemptCount >= MAX_DELIVERY_ATTEMPTS;
  const nextStatus = exhausted ? "FAILED" : "PENDING";
  await prisma.bookingEmailDelivery.update({
    where: { id: deliveryId },
    data: { status: nextStatus, lastError: result.errorClass },
  });
  logger.warn("bookingEmail.delivery_failed", {
    deliveryId,
    bookingId,
    kind,
    attemptCount,
    errorClass: result.errorClass,
    retryable: result.retryable,
    terminal: exhausted,
  });
  return exhausted ? "failed" : "retried";
}

async function markTerminal(
  deliveryId: string,
  status: "FAILED" | "SKIPPED",
  errorClass: string | null,
  now: Date,
): Promise<void> {
  await prisma.bookingEmailDelivery.update({
    where: { id: deliveryId },
    data: { status, lastError: errorClass, lastAttemptAt: now },
  });
}
