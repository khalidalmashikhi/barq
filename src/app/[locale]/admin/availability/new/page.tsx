import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createAvailability } from "@/lib/admin/create-availability";
import { isAvailabilityAdminActionErrorCode, getAvailabilityAdminErrorTranslationKey } from "@/lib/admin/availability-admin-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Availability (admin-initiated) — Phase 2.8 (Availability
// Admin UI). Mirrors admin/prices/new/page.tsx's form shape and the
// datetime-local input convention already established in
// provider/availability/new/page.tsx. No service picker: an admin
// identifies the target service by ID (same accepted raw-UUID tradeoff
// as every other Foundation phase's admin Create form) — admin manages
// every provider's services, unlike the self-service form's own
// provider-scoped <select>.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewAvailabilityPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isAvailabilityAdminActionErrorCode(error) ? t(getAvailabilityAdminErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/availability" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToAvailabilityLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createAvailabilityTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createAvailability(formData);
            if (!result.ok) {
              redirect({ href: `/admin/availability/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/availability/${result.slotId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("availabilityServiceIdLabel")}</span>
            <input
              type="text"
              name="serviceId"
              required
              dir="ltr"
              placeholder="019f4e4e-8116-7052-b15e-000000000000"
              className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("availabilityServiceIdHintLabel")}</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("availabilityStartTimeLabel")}</span>
              <input
                type="datetime-local"
                name="startTime"
                required
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("availabilityEndTimeLabel")}</span>
              <input
                type="datetime-local"
                name="endTime"
                required
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5 sm:w-48">
            <span className="text-xs font-medium text-foreground/50">{t("availabilityCapacityLabel")}</span>
            <input
              type="number"
              name="capacity"
              min={1}
              step={1}
              required
              defaultValue={1}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createAvailabilitySubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
