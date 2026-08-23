import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import { Calendar, CalendarX, PackageX, Users, ArrowRight } from "lucide-react";
import { getSession, isActiveAdminSession } from "@/lib/auth";
import { resolveBarqUser } from "@/lib/auth/barq-user";
import { getServiceById, getActivePricesForService } from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { serviceRequiresSlot } from "@/lib/booking/service-requires-slot";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/booking/create-booking";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { BookingStepsIndicator } from "@/components/bookings/booking-steps-indicator";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>; };

// Phase B Group 7 Final Audit — CRITICAL FIX: this page requires an
// authenticated session (redirects to "/" otherwise, same pattern as
// Dashboard/Bookings/Provider) but was missed when Group 5 Closure
// applied the approved "private authenticated routes get explicit
// noindex/nofollow" policy to Dashboard, Bookings, and Provider.
// Verified live: unauthenticated access returned 200 with zero robots
// tag before this fix. No canonical/hreflang — this route was never
// meant to be indexed under any locale.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookServicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const locale = await getLocale();

  const session = await getSession();
  if (!session) { redirect({ href: "/login", locale }); return null; }

  // Gate A (Admin Backoffice Hardening) — an ACTIVE Admin is backoffice-only and may
  // not book. Redirect it to /admin SERVER-SIDE before the booking form renders;
  // createBooking() (via requireCustomer) independently denies it too.
  if (await isActiveAdminSession()) { redirect({ href: "/admin", locale }); return null; }

  const fetchedService = await getServiceById(id);
  if (!fetchedService) { notFound(); return null; }
  const service = fetchedService;

  // BOOKING-SLOT-AUTHORITY — `slots.length > 0` is NO LONGER the definition of
  // "this service needs a slot". An empty list is ambiguous (no slots exist vs. every
  // slot is full/past/blocked), and treating it as "slotless" let this form submit
  // without an availabilityId against a slot-based service — which skipped the atomic
  // capacity guard entirely. The rule now comes from the SAME authority createBooking()
  // enforces, so the form can never offer something the server will refuse.
  const [prices, slots, requiresSlot] = await Promise.all([
    getActivePricesForService(service.id),
    getAvailableSlots(service.id),
    serviceRequiresSlot(service.id),
  ]);

  const barqUser = await resolveBarqUser(session.user.id);
  const customer = await prisma.customer.findUnique({ where: { userId: barqUser.id } });

  const t = await getServerTranslator("booking");
  const tErrors = await getServerTranslator("errors");
  const errorMessage = error && isBookingActionErrorCode(error) ? tErrors(getBookingErrorTranslationKey(error)) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <BookingStepsIndicator currentStep={2} />
      <div>
        <Link
          href={`/services/${service.id}`}
          className="mb-2 inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
        >
          <ArrowRight size={16} strokeWidth={1.75} />
          {t("backToExperienceButton")}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{t("bookServiceTitle", { serviceName: service.name })}</h1>
        <p className="mt-1 text-sm text-foreground/50">{service.providerName}</p>
      </div>
      {errorMessage && error !== "NO_CUSTOMER_PROFILE" && <Alert variant="danger">{errorMessage}</Alert>}
      {!customer && <Alert variant="warning">{tErrors("noCustomerProfile")}</Alert>}
      {prices.length === 0 ? (
        <EmptyState icon={PackageX} message={t("noPricesAvailableLabel")} padding="py-10" />
      ) : requiresSlot && slots.length === 0 ? (
        // Slot-based, but nothing is bookable right now. Deliberately renders NO form:
        // any form here could only submit without an availabilityId, which the server
        // now refuses with SLOT_REQUIRED — so offering it would be an affordance that
        // cannot succeed.
        <EmptyState icon={CalendarX} message={t("noSlotsAvailableLabel")} padding="py-10" />
      ) : (
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createBooking(formData);
            if (!result.ok) {
              redirect({ href: `/services/${service.id}/book?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/bookings/${result.bookingId}/confirmation`, locale });
          }}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <input type="hidden" name="serviceId" value={service.id} />
          {requiresSlot && (
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                <Calendar size={16} strokeWidth={1.75} />
                {t("selectSlotLabel")}
              </legend>
              {slots.map((slot) => (
                <label key={slot.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20">
                  <span className="flex items-center gap-3">
                    <input type="radio" name="availabilityId" value={slot.id} required className="accent-primary" />
                    {formatDate(new Date(slot.startTime), locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-xs text-foreground/50">{slot.remainingSeats} {t("remainingSeatsLabel")}</span>
                </label>
              ))}
            </fieldset>
          )}
          {requiresSlot && (
            <div className="flex flex-col gap-2">
              <label htmlFor="seats" className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                <Users size={16} strokeWidth={1.75} />
                {t("seatsLabel")}
              </label>
              <input id="seats" type="number" name="seats" min={1} defaultValue={1} required className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground/80">{t("selectPriceLabel")}</legend>
            {prices.map((price) => (
              <label key={price.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20">
                <input type="radio" name="priceId" value={price.id} required className="accent-primary" />
                {price.amount} {price.currency}
              </label>
            ))}
          </fieldset>
          <SubmitButton disabled={!customer} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {t("confirmBookingButton")}
          </SubmitButton>
        </form>
      )}
      </main>
      <Footer />
    </div>
  );
}
