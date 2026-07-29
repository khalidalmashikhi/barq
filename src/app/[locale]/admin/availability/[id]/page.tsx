import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Edit } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAvailabilitySlotDetail } from "@/lib/admin/get-availability-slot-detail";
import { activateAvailability, deactivateAvailability } from "@/lib/admin/transition-availability-state";
import { getAvailabilityStateBadgeVariant, getAvailabilityStateTranslationKey } from "@/lib/admin/presentation/availability-state";
import { isAvailabilityAdminActionErrorCode, getAvailabilityAdminErrorTranslationKey } from "@/lib/admin/availability-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Availability detail — Phase 2.8 (Availability Admin UI). Mirrors
// admin/prices/[id]/page.tsx's shape: status-changing actions live
// here, the list row keeps single-click quick actions too. Edit always
// links to a dedicated form (capacity is always editable; the form
// itself decides whether time fields are editable, based on
// bookedCount — see that page's own note).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AvailabilityDetailPage({ params, searchParams }: Props) {
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/availability" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToAvailabilityLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {formatDate(slot.startTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            {" – "}
            {formatDate(slot.endTime, locale, { hour: "2-digit", minute: "2-digit" })}
          </h1>
          <p className="mt-0.5 text-sm text-foreground/40">{slot.serviceName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getAvailabilityStateBadgeVariant(slot.state)}>{t(getAvailabilityStateTranslationKey(slot.state))}</Badge>
          <Link
            href={`/admin/availability/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Edit size={14} strokeWidth={1.75} />
            {t("editAvailabilityButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("availabilityDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("availabilityServiceLabel")}</dt>
            <dd className="text-sm text-foreground">{slot.serviceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("availabilityCapacityLabel")}</dt>
            <dd className="text-sm text-foreground">{slot.capacity}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("availabilityBookedCountLabel")}</dt>
            <dd className="text-sm text-foreground">{slot.bookedCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("availabilityRemainingSeatsLabel")}</dt>
            <dd className="text-sm text-foreground">{slot.remainingSeats}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("availabilityCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(slot.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("availabilityActionsTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {slot.state === "OPEN" && (
            <form
              action={async () => {
                "use server";
                const result = await deactivateAvailability(id);
                if (!result.ok) {
                  redirect({ href: `/admin/availability/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/availability/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("deactivateAvailabilityButton")}
              </SubmitButton>
            </form>
          )}

          {slot.state === "BLOCKED" && (
            <form
              action={async () => {
                "use server";
                const result = await activateAvailability(id);
                if (!result.ok) {
                  redirect({ href: `/admin/availability/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/availability/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                {t("activateAvailabilityButton")}
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
