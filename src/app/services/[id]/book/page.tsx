import { redirect, notFound } from "next/navigation";
import { AlertCircle, Calendar, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { resolveBarqUser } from "@/lib/auth/barq-user";
import { getServiceById, getActivePricesForService } from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/booking/create-booking";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Booking form page — Engineering Sprint (Availability Engine).
//
// Slot selection now comes BEFORE price selection, per explicit
// requirement — the form fieldsets are ordered slot -> seats -> price.
// A service with no Availability rows at all skips the slot section
// entirely and books exactly as before this sprint (preserving
// existing behavior for services that never adopt scheduling).
//
// AUTH: uses getSession() (not requireAuth()) for a clean redirect on
// an unauthenticated visit — createBooking() independently re-checks
// auth server-side regardless, so this is a UX nicety, not the real
// security boundary.
//
// PHASE A.4 HOTFIX: the Customer lookup below now resolves the real
// BARQ User via resolveBarqUser(session.user.id) before querying
// Customer.userId — the same function requireAuth()/rbac.ts already
// use correctly elsewhere (e.g. get-booking-detail.ts). Previously
// this queried Customer.userId directly with session.user.id, which
// is Better Auth's own AuthUser.id (not a UUID) — a real, pre-existing
// bug that crashed this page for every visitor, discovered during
// Phase A.4's own verification. No new helper was written; this reuses
// the existing resolution function exactly as-is.
//
// INTERNATIONALIZATION PHASE A.4: createBooking() now returns a
// stable BookingActionErrorCode, never localized text — the incoming
// `?error=` query value is validated with isBookingActionErrorCode()
// before being translated (never trusted as-is; an unrecognized value
// shows no message). NO_CUSTOMER_PROFILE remains excluded from the
// generic error banner below, unchanged from before this migration —
// its dedicated message is now sourced from the same `errors`
// namespace instead of being hardcoded a second time.

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function BookServicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  const fetchedService = await getServiceById(id);
  if (!fetchedService) {
    notFound();
    return null;
  }
  const service = fetchedService;

  const [prices, slots] = await Promise.all([
    getActivePricesForService(service.id),
    getAvailableSlots(service.id),
  ]);

  const barqUser = await resolveBarqUser(session.user.id);
  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  const t = await getServerTranslator("booking");
  const tErrors = await getServerTranslator("errors");
  const errorMessage = error && isBookingActionErrorCode(error) ? tErrors(getBookingErrorTranslationKey(error)) : null;
  const locale = await getLocale();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("bookServiceTitle", { serviceName: service.name })}</h1>
        <p className="mt-1 text-sm text-foreground/50">{service.providerName}</p>
      </div>

      {errorMessage && error !== "NO_CUSTOMER_PROFILE" && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4">
          <AlertCircle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-danger">{errorMessage}</p>
        </div>
      )}

      {!customer && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
          <AlertCircle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent-foreground" />
          <p className="text-sm text-accent-foreground">{tErrors("noCustomerProfile")}</p>
        </div>
      )}

      {prices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center">
          <p className="text-sm text-foreground/50">{t("noPricesAvailableLabel")}</p>
        </div>
      ) : (
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createBooking(formData);
            if (!result.ok) {
              redirect(`/services/${service.id}/book?error=${result.error}`);
              return;
            }
            redirect(`/bookings/${result.bookingId}/confirmation`);
          }}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <input type="hidden" name="serviceId" value={service.id} />

          {/* Slot selection — comes first, per explicit requirement.
              Only rendered if this service actually has slots; a
              service with none is booked exactly as before this sprint. */}
          {slots.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                <Calendar size={16} strokeWidth={1.75} />
                {t("selectSlotLabel")}
              </legend>
              {slots.map((slot) => (
                <label
                  key={slot.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20"
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="availabilityId" value={slot.id} required className="accent-primary" />
                    {formatDate(new Date(slot.startTime), locale, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-xs text-foreground/50">
                    {slot.remainingSeats} {t("remainingSeatsLabel")}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {slots.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="seats" className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                <Users size={16} strokeWidth={1.75} />
                {t("seatsLabel")}
              </label>
              <input
                id="seats"
                type="number"
                name="seats"
                min={1}
                defaultValue={1}
                required
                className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground/80">{t("selectPriceLabel")}</legend>
            {prices.map((price) => (
              <label
                key={price.id}
                className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20"
              >
                <input type="radio" name="priceId" value={price.id} required className="accent-primary" />
                {price.amount} {price.currency}
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            disabled={!customer}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("confirmBookingButton")}
          </button>
        </form>
      )}
    </main>
  );
}
