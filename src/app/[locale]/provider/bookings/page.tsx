import { notFound } from "next/navigation";
import { CalendarX, AlertCircle } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderBookings } from "@/lib/provider/queries/get-provider-bookings";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { acceptBooking } from "@/lib/booking/accept-booking";
import { rejectBooking } from "@/lib/booking/reject-booking";
import { startBooking } from "@/lib/booking/start-booking";
import { completeBooking } from "@/lib/booking/complete-booking";
import { canStartBooking, canCompleteBooking } from "@/lib/booking/cancellation-policy";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { ProviderBookingFilters } from "@/components/bookings/provider-booking-filters";
import { BookingStatusProgress } from "@/components/bookings/booking-status-progress";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import { clsx } from "@/components/ui/clsx";
import type { BookingStatus } from "@prisma/client";

// Provider Bookings — Provider Dashboard Phase 1c (Bookings Workspace
// Foundation, read-only), extended in Phase 4.1 ("Complete the Booking
// Lifecycle") with the provider's real Accept/Reject actions.
//
// CUSTOMER IDENTITY: no name/phone/email is ever rendered — only the
// generic provider.bookingCustomerLabel ("Customer"/"عميل"), per
// explicit product decision (see get-provider-bookings.ts's own note
// on why no customer-identifying field exists in the DTO at all).
//
// ROWS, NOT A DETAIL LINK YET: each row is a single wrapping <div>,
// keyed by and built around the real booking id — not yet a <Link>
// (no /provider/bookings/[id] exists) — but structured so that page
// can be added later without restructuring this list.
//
// PHASE 4.1: "Needs action" now reflects PENDING_PROVIDER (the real
// status a provider must act on since the lifecycle gained a real
// provider gate — see transitions.ts), not CREATED. Two inline forms
// (Accept / Reject with an optional reason) are shown only on rows in
// that status, mirroring the exact inline-server-action-form pattern
// already used by the customer's cancel button in bookings/[id]/page.tsx
// — no new /provider/bookings/[id] detail page, keeping this the
// smallest surface that satisfies the requirement.
//
// PHASE 4.2 (Priority 3 — Booking Operations): the same inline-form
// pattern extended to Start (CONFIRMED -> IN_PROGRESS) and Complete
// (IN_PROGRESS -> COMPLETED), reusing the exact transitions the
// lifecycle engine has supported since Phase E.1 — just never wired to
// a real provider action until now.

const VALID_STATUSES: BookingStatus[] = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
];

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
  error?: string;
};

export default async function ProviderBookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  const status = VALID_STATUSES.includes(params.status as BookingStatus) ? (params.status as BookingStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // Phase C.3 Group 2 — CRITICAL FIX: getProviderBookings() calls
  // requireProvider() internally, which throws UnauthenticatedError/
  // ForbiddenError rather than returning an empty result — previously
  // uncaught here. Same catch-and-handle pattern as
  // src/app/[locale]/provider/layout.tsx.
  let result;
  try {
    result = await getProviderBookings({ q: params.q, status, page });
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

  const hasActiveFilter = Boolean(params.q || params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const bookingsBasePath = getPathname({ href: "/provider/bookings", locale });
  const tErrors = await getServerTranslator("errors");
  const errorMessage =
    params.error && isBookingActionErrorCode(params.error) ? tErrors(getBookingErrorTranslationKey(params.error)) : null;

  // Preserves the page's own filters (q/status/page) across an Accept/
  // Reject redirect, so acting on a booking never silently discards
  // whatever the provider was searching for. Captured as plain data
  // (currentQ/currentStatus/currentPage below), not a helper function
  // reference — an inline server action's closure can only serialize
  // plain values, not a reference to an ordinary function defined in
  // this module (confirmed live: Next.js threw "Functions cannot be
  // passed directly to Client Components" when a shared
  // redirectTarget() function was called from inside the action).
  const currentQ = params.q;
  const currentStatus = params.status;
  const currentPage = params.page;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t("bookingsTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <ProviderBookingFilters currentSearch={params.q} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarX} message={t("noBookingsLabel")} description={t("noBookingsDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarX} message={tBooking("noBookingsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarX} message={t("noBookingsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => {
            const needsAction = item.status === "PENDING_PROVIDER";
            const canStart = canStartBooking(item.status);
            const canComplete = canCompleteBooking(item.status);
            return (
              <div
                key={item.id}
                className={clsx(
                  "flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm",
                  needsAction ? "border-accent/60" : "border-border"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/provider/bookings/${item.id}`} className="min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-foreground hover:underline">{item.serviceName}</p>
                      {needsAction && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">
                          <AlertCircle size={11} strokeWidth={2} />
                          {t("needsActionLabel")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {t("bookingCustomerLabel")} ·{" "}
                      {item.slotStartTime
                        ? formatDate(new Date(item.slotStartTime), locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                        : formatDate(new Date(item.createdAt), locale, { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-foreground/50">×{item.seats}</span>
                    {item.priceSnapshot && <span className="text-sm font-semibold text-primary">{item.priceSnapshot}</span>}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(item.status)}`}>
                      {getBookingStatusLabel(item.status, tBooking)}
                    </span>
                  </div>
                </div>
                <BookingStatusProgress status={item.status} />

                {needsAction && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <form
                      action={async () => {
                        "use server";
                        const result = await acceptBooking(item.id);
                        const qs = new URLSearchParams();
                        if (currentQ) qs.set("q", currentQ);
                        if (currentStatus) qs.set("status", currentStatus);
                        if (currentPage) qs.set("page", currentPage);
                        if (!result.ok) qs.set("error", result.error);
                        const query = qs.toString();
                        redirect({ href: query ? `/provider/bookings?${query}` : "/provider/bookings", locale });
                      }}
                    >
                      <SubmitButton className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                        {t("acceptBookingButton")}
                      </SubmitButton>
                    </form>
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        const reasonRaw = formData.get("reason");
                        const reason = typeof reasonRaw === "string" ? reasonRaw : undefined;
                        const result = await rejectBooking(item.id, reason);
                        const qs = new URLSearchParams();
                        if (currentQ) qs.set("q", currentQ);
                        if (currentStatus) qs.set("status", currentStatus);
                        if (currentPage) qs.set("page", currentPage);
                        if (!result.ok) qs.set("error", result.error);
                        const query = qs.toString();
                        redirect({ href: query ? `/provider/bookings?${query}` : "/provider/bookings", locale });
                      }}
                      className="flex flex-1 flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        name="reason"
                        placeholder={t("rejectReasonPlaceholder")}
                        maxLength={280}
                        className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <SubmitButton className="shrink-0 rounded-full border border-danger/30 bg-danger/5 px-4 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50">
                        {t("rejectBookingButton")}
                      </SubmitButton>
                    </form>
                  </div>
                )}

                {(canStart || canComplete) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {canStart && (
                      <form
                        action={async () => {
                          "use server";
                          const result = await startBooking(item.id);
                          const qs = new URLSearchParams();
                          if (currentQ) qs.set("q", currentQ);
                          if (currentStatus) qs.set("status", currentStatus);
                          if (currentPage) qs.set("page", currentPage);
                          if (!result.ok) qs.set("error", result.error);
                          const query = qs.toString();
                          redirect({ href: query ? `/provider/bookings?${query}` : "/provider/bookings", locale });
                        }}
                      >
                        <SubmitButton className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                          {t("startBookingButton")}
                        </SubmitButton>
                      </form>
                    )}
                    {canComplete && (
                      <form
                        action={async () => {
                          "use server";
                          const result = await completeBooking(item.id);
                          const qs = new URLSearchParams();
                          if (currentQ) qs.set("q", currentQ);
                          if (currentStatus) qs.set("status", currentStatus);
                          if (currentPage) qs.set("page", currentPage);
                          if (!result.ok) qs.set("error", result.error);
                          const query = qs.toString();
                          redirect({ href: query ? `/provider/bookings?${query}` : "/provider/bookings", locale });
                        }}
                      >
                        <SubmitButton className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                          {t("completeBookingButton")}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={bookingsBasePath} />
    </div>
  );
}
