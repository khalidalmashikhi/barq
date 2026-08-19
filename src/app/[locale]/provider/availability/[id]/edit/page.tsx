import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAvailabilitySlotForEdit } from "@/lib/provider/queries/get-availability-slot-for-edit";
import { updateAvailabilitySlot } from "@/lib/provider/update-availability-slot";
import { isAvailabilityActionErrorCode, getAvailabilityErrorTranslationKey } from "@/lib/provider/availability-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { utcToOmanDatetimeLocal } from "@/lib/date/oman-time";

// Edit Availability Slot — Phase 4.2 (Provider Experience),
// Priority 2. Capacity is always editable; start/end time inputs are
// only rendered when bookedCount is 0 — see update-availability-slot.ts's
// own note on why a booked slot's time must not be changeable from
// here. When bookedCount > 0, the current time is shown as plain read-
// only text instead, so the provider still sees it without being able
// to silently move it.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

// datetime-local inputs require an Oman-local "YYYY-MM-DDTHH:mm" with no timezone
// designator — the inverse of update-availability-slot.ts's omanLocalToUtc parse.
// It MUST render the stored UTC instant in Asia/Muscat, not the server-local
// timezone (utcToOmanDatetimeLocal), or the prefilled time would drift by the
// server's offset. Distinct from formatDate()'s locale-aware display formatting,
// which is not machine-parseable by this input type.
const toDatetimeLocalValue = utcToOmanDatetimeLocal;

export default async function EditAvailabilitySlotPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let slot;
  try {
    slot = await getAvailabilitySlotForEdit(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  if (!slot) {
    notFound();
  }

  const errorMessage = error && isAvailabilityActionErrorCode(error) ? t(getAvailabilityErrorTranslationKey(error)) : null;
  const canEditTime = slot.bookedCount === 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/availability"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToAvailabilityLabel")}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("editSlotTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{slot.serviceName}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {!canEditTime && <Alert variant="info">{t("slotTimeLockedLabel")}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateAvailabilitySlot(id, formData);
            if (!result.ok) {
              redirect({ href: `/provider/availability/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/provider/availability", locale });
          }}
          className="flex flex-col gap-4"
        >
          {canEditTime ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("startTimeLabel")}</span>
                <input
                  type="datetime-local"
                  name="startTime"
                  required
                  defaultValue={toDatetimeLocalValue(slot.startTime)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("endTimeLabel")}</span>
                <input
                  type="datetime-local"
                  name="endTime"
                  required
                  defaultValue={toDatetimeLocalValue(slot.endTime)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground/50">{t("startTimeLabel")}</span>
                <span className="text-foreground">
                  {formatDate(slot.startTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground/50">{t("endTimeLabel")}</span>
                <span className="text-foreground">
                  {formatDate(slot.endTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5 sm:w-48">
            <span className="text-xs font-medium text-foreground/50">{t("capacityFieldLabel")}</span>
            <input
              type="number"
              name="capacity"
              min={slot.bookedCount || 1}
              step={1}
              required
              defaultValue={slot.capacity}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("editSlotSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
