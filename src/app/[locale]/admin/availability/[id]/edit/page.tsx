import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAvailabilitySlotDetail } from "@/lib/admin/get-availability-slot-detail";
import { updateAvailability } from "@/lib/admin/update-availability";
import { isAvailabilityAdminActionErrorCode, getAvailabilityAdminErrorTranslationKey } from "@/lib/admin/availability-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Edit Availability — Phase 2.8 (Availability Admin UI). Mirrors
// provider/availability/[id]/edit/page.tsx's exact business-rule
// surfacing: capacity is always editable; start/end time inputs are
// only rendered when bookedCount is 0 (updateAvailability() itself
// refuses a time change otherwise with SLOT_HAS_BOOKINGS — this page
// never lets the admin attempt what the backend would reject, but the
// refusal logic itself lives only in updateAvailability(), not
// duplicated here). When bookedCount > 0, the current time is shown as
// plain read-only text instead.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

// datetime-local inputs require "YYYY-MM-DDTHH:mm" with no timezone
// designator — same helper as provider/availability/[id]/edit/page.tsx,
// distinct from formatDate()'s locale-aware display formatting, which
// is not machine-parseable by this input type.
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EditAvailabilityPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let slot;
  try {
    slot = await getAvailabilitySlotDetail(id);
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

  const errorMessage = error && isAvailabilityAdminActionErrorCode(error) ? t(getAvailabilityAdminErrorTranslationKey(error)) : null;
  const canEditTime = slot.bookedCount === 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href={`/admin/availability/${id}`} className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToAvailabilityLabel")}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("editAvailabilityTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{slot.serviceName}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {!canEditTime && <Alert variant="info">{t("availabilityTimeLockedLabel")}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateAvailability(id, formData);
            if (!result.ok) {
              redirect({ href: `/admin/availability/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/availability/${id}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          {canEditTime ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("availabilityStartTimeLabel")}</span>
                <input
                  type="datetime-local"
                  name="startTime"
                  required
                  defaultValue={toDatetimeLocalValue(slot.startTime)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("availabilityEndTimeLabel")}</span>
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
                <span className="text-xs font-medium text-foreground/50">{t("availabilityStartTimeLabel")}</span>
                <span className="text-foreground">
                  {formatDate(slot.startTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground/50">{t("availabilityEndTimeLabel")}</span>
                <span className="text-foreground">
                  {formatDate(slot.endTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5 sm:w-48">
            <span className="text-xs font-medium text-foreground/50">{t("availabilityCapacityLabel")}</span>
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
            {t("saveChangesButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
