import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Download, Share2, MessageCircle, Compass } from "lucide-react";
import { UnauthenticatedError } from "@/lib/auth";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { BookingStepsIndicator } from "@/components/bookings/booking-steps-indicator";
import { SuccessCheck } from "@/components/bookings/success-check";
import { ShareButton } from "@/components/ui/share-button";

// Booking confirmation page — Engineering Sprint (Booking Engine).
//
// COPY DELIBERATELY SAYS "request received," not "booking confirmed" —
// the actual BookingStatus is CREATED, not CONFIRMED, since no payment/
// confirmation step exists in this sprint. Saying "confirmed" here
// would misrepresent the real status shown one click away on the
// detail page — a real status/copy mismatch this page specifically
// avoids.

type Props = {
  params: Promise<{ id: string }>;
};

// Phase B Group 5 Closure — private, authenticated route: explicit
// noindex/nofollow as defense-in-depth. No canonical/hreflang.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookingConfirmationPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();

  // Phase C.2 — CRITICAL FIX: same uncaught UnauthenticatedError issue
  // as src/app/[locale]/bookings/[id]/page.tsx — see that file's
  // comment for the full explanation.
  let fetchedBooking;
  try {
    fetchedBooking = await getBookingDetail(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw err;
  }

  if (!fetchedBooking) {
    notFound();
    return null;
  }

  const booking = fetchedBooking;

  // Phase C.3 Group 1 — booking confirmation review: this page always
  // rendered "request received, you'll be notified once confirmed" for
  // any booking id the customer owns, regardless of its current
  // status. Visiting an old confirmation URL for a booking since
  // cancelled (e.g. a bookmarked link) showed that same forward-looking
  // copy for a booking that will never be confirmed — send the
  // customer to the detail page instead, which already shows the real,
  // current status correctly.
  if (booking.status === "CANCELLED") {
    redirect({ href: `/bookings/${booking.id}`, locale });
    return null;
  }

  const t = await getServerTranslator("booking");
  const tDashboard = await getServerTranslator("dashboard");
  const unreadNotificationsCount = await getUnreadCount();

  // Phase C.3 Group 3 — UX FIX: same missing-AppShell gap as
  // src/app/[locale]/bookings/page.tsx — see that file's comment.
  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <BookingStepsIndicator currentStep={3} />
        <SuccessCheck />
        <h1 className="text-xl font-semibold text-foreground">{t("confirmationReceivedTitle")}</h1>
        <p className="text-sm text-foreground/60">
          {booking.serviceName} — {booking.providerName}
        </p>
        {booking.priceSnapshot && (
          <p className="text-lg font-semibold text-primary">{booking.priceSnapshot}</p>
        )}
        {booking.slotStartTime && (
          <p className="text-sm text-foreground/60">
            {formatDate(new Date(booking.slotStartTime), locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" — "}
            {booking.seats} {t("seatsSuffixLabel")}
          </p>
        )}

        <div className="mt-2 w-full rounded-2xl border border-border bg-card p-5 text-start">
          <h2 className="text-xs font-medium text-foreground/50">{t("whatsNextTitle")}</h2>
          <p className="mt-2 text-sm text-foreground/70">{t("confirmationNoticeText")}</p>
        </div>

        <div className="mt-1 grid w-full grid-cols-3 gap-2">
          <button
            type="button"
            disabled
            aria-disabled
            title={t("comingSoonLabel")}
            className="flex cursor-not-allowed flex-col items-center gap-1 rounded-xl border border-dashed border-border px-3 py-3 text-xs font-medium text-foreground/35"
          >
            <Download size={16} strokeWidth={1.75} />
            <span>{t("downloadLabel")}</span>
            <span className="text-[0.65rem] font-normal text-foreground/25">{t("comingSoonLabel")}</span>
          </button>
          <ShareButton
            url={buildPublicUrl(locale, `/services/${booking.serviceId}`)}
            title={booking.serviceName}
            text={t("shareBookingText", { serviceName: booking.serviceName })}
            label={t("shareLabel")}
            copiedLabel={t("shareCopiedLabel")}
            errorLabel={t("shareErrorLabel")}
            icon={<Share2 size={16} strokeWidth={1.75} />}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            wrapperClassName="w-full"
          />
          <button
            type="button"
            disabled
            aria-disabled
            title={t("comingSoonLabel")}
            className="flex cursor-not-allowed flex-col items-center gap-1 rounded-xl border border-dashed border-border px-3 py-3 text-xs font-medium text-foreground/35"
          >
            <MessageCircle size={16} strokeWidth={1.75} />
            <span>{t("contactProviderShortLabel")}</span>
            <span className="text-[0.65rem] font-normal text-foreground/25">{t("comingSoonLabel")}</span>
          </button>
        </div>

        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
          <Link
            href={`/bookings/${booking.id}`}
            className="flex-1 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("viewDetailsButton")}
          </Link>
          <Link
            href="/services"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Compass size={15} strokeWidth={1.75} />
            {t("continueExploringButton")}
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
