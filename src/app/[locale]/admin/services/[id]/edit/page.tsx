import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getServiceDetail } from "@/lib/admin/get-service-detail";
import { updateService } from "@/lib/admin/update-service";
import { isServiceAdminActionErrorCode, getServiceAdminErrorTranslationKey } from "@/lib/admin/service-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { CategoryField } from "@/components/categories/category-field";
import { RegionField } from "@/components/regions/region-field";
import { PricingUnitField } from "@/components/pricing-units/pricing-unit-field";

// Edit Service — Phase 2.4 (Service Admin UI). Mirrors
// admin/providers/[id]/edit/page.tsx's shape, pre-filled from
// getServiceDetail()'s raw bilingual Json (both languages at once).
// No providerId field — reassigning ownership is out of scope, same as
// update-service.ts itself not accepting it. Only mutates name/
// description — status changes go through the separate actions on the
// detail page, mirroring Provider/Category's own mutation/transition
// split.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditServicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let service;
  try {
    service = await getServiceDetail(id);
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

  if (!service) {
    notFound();
  }

  const errorMessage = error && isServiceAdminActionErrorCode(error) ? t(getServiceAdminErrorTranslationKey(error)) : null;

  // BR-028: offer the UNIFIED assignable set across every vertical — changing the
  // category re-derives serviceType server-side. Existing safe edit semantics are
  // preserved: the current categoryId is still passed as the field's defaultValue.
  const categoryTree = await getSelectableCategories();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href={`/admin/services/${id}`} className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServiceLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("editServiceTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateService(id, formData);
            if (!result.ok) {
              redirect({ href: `/admin/services/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/services/${id}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceNameArLabel")}</span>
              <input
                type="text"
                name="nameAr"
                required
                dir="rtl"
                defaultValue={service.name.ar}
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
                defaultValue={service.name.en}
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
                defaultValue={service.description?.ar ?? ""}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("serviceDescriptionEnLabel")}</span>
              <textarea
                name="descriptionEn"
                rows={3}
                dir="ltr"
                defaultValue={service.description?.en ?? ""}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("categoryFieldLabel")}</span>
            <CategoryField
              name="categoryId"
              tree={categoryTree}
              defaultValue={service.categoryId}
              labels={{ searchPlaceholder: t("categorySearchPlaceholder"), empty: t("categoryEmpty") }}
            />
            <span className="text-xs text-foreground/40">{t("categoryFieldHint")}</span>
          </div>

          {/* Governorate (Gate 4), prefilled from the current value. */}
          <RegionField defaultValue={service.regionCode} />

          {/* Pricing unit is exposed ONLY when an ACTIVE price exists to attach it
              to — this admin surface does not create prices (Gate 3/6). It updates
              the active price's unit metadata only; amount/currency untouched. */}
          {service.activePrice && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PricingUnitField defaultValue={service.activePrice.pricingUnit} />
            </div>
          )}

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("saveChangesButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
