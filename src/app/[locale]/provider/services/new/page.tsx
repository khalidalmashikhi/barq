import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createService } from "@/lib/provider/create-service";
import { isServiceActionErrorCode, getServiceErrorTranslationKey } from "@/lib/provider/service-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { CategoryField } from "@/components/categories/category-field";
import { RegionField } from "@/components/regions/region-field";
import { PricingUnitField } from "@/components/pricing-units/pricing-unit-field";

// Create Experience — Phase 4.2 (Provider Experience), Priority 1.
// Collects both ar/en name (Service.name is bilingual-required, see
// create-service.ts's own note) plus an initial price — a service
// created with no price can never be published, so the price field is
// part of creation, not a separate later step. serviceType is not a
// form field: it's hardcoded "EXPERIENCE" server-side (see
// create-service.ts), the only real value in use.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewServicePage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  const errorMessage = error && isServiceActionErrorCode(error) ? t(getServiceErrorTranslationKey(error)) : null;

  // BR-028: offer the UNIFIED assignable category set across every vertical — the
  // chosen category DRIVES the service type server-side (there is no serviceType
  // picker; the provider only picks a category).
  const categoryTree = await getSelectableCategories();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/services"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createExperienceTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createService(formData);
            if (!result.ok) {
              redirect({ href: `/provider/services/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/services/${result.serviceId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("nameArLabel")}</span>
              <input
                type="text"
                name="nameAr"
                required
                dir="rtl"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("nameEnLabel")}</span>
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
              <span className="text-xs font-medium text-foreground/50">{t("descriptionArLabel")}</span>
              <textarea
                name="descriptionAr"
                rows={3}
                dir="rtl"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("descriptionEnLabel")}</span>
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

          {/* Governorate — optional discovery metadata (Gate 4). Its own row so it
              never crowds the category picker or the price on phones. */}
          <RegionField defaultValue={null} />

          {/* Price + its display unit, paired. On phones they stack (grid-cols-1);
              from sm they sit side by side. The unit is DISPLAY METADATA ONLY. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("priceAmountLabel")}</span>
              <input
                type="text"
                inputMode="decimal"
                name="priceAmount"
                required
                placeholder="0.00"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <PricingUnitField defaultValue={null} />
          </div>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
