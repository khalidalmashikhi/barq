import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createService } from "@/lib/admin/create-service";
import { isServiceAdminActionErrorCode, getServiceAdminErrorTranslationKey } from "@/lib/admin/service-admin-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { CategoryField } from "@/components/categories/category-field";
import { RegionField } from "@/components/regions/region-field";

// Create Service (admin-initiated) — Phase 2.4 (Service Admin UI).
// Mirrors admin/providers/new/page.tsx's form shape. Distinct from the
// pre-existing self-service /provider/services/new flow: this lets an
// admin directly provision a Service for an existing Provider
// (identified by providerId — no picker exists yet, same accepted
// tradeoff Phase 2.3 documented for Create Provider's userId field).
// No price field: Pricing Rules are out of this phase's scope, same as
// Phase 2.3's create-service.ts action itself.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewServicePage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isServiceAdminActionErrorCode(error) ? t(getServiceAdminErrorTranslationKey(error)) : null;

  // BR-028: offer the UNIFIED assignable category set across every vertical — the
  // chosen category DRIVES the service type server-side (no serviceType picker).
  const categoryTree = await getSelectableCategories();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/services" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createServiceTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createService(formData);
            if (!result.ok) {
              redirect({ href: `/admin/services/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/services/${result.serviceId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("serviceProviderIdLabel")}</span>
            <input
              type="text"
              name="providerId"
              required
              dir="ltr"
              placeholder="019f4e4e-8116-7052-b15e-000000000000"
              className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("serviceProviderIdHintLabel")}</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceNameArLabel")}</span>
              <input
                type="text"
                name="nameAr"
                required
                dir="rtl"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceNameEnLabel")}</span>
              <input
                type="text"
                name="nameEn"
                required
                dir="ltr"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceDescriptionArLabel")}</span>
              <textarea
                name="descriptionAr"
                rows={3}
                dir="rtl"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceDescriptionEnLabel")}</span>
              <textarea
                name="descriptionEn"
                rows={3}
                dir="ltr"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("categoryFieldLabel")}</span>
            <CategoryField
              name="categoryId"
              tree={categoryTree}
              labels={{ searchPlaceholder: t("categorySearchPlaceholder"), empty: t("categoryEmpty") }}
            />
            <span className="text-xs text-foreground/40">{t("categoryFieldHint")}</span>
          </div>

          {/* Governorate (Gate 4). No pricing-unit field here: this admin-create
              path deliberately provisions no Price (Gate 3), so there is no Price
              row for a unit to attach to — it becomes editable once a price exists. */}
          <RegionField defaultValue={null} />

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createServiceSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
