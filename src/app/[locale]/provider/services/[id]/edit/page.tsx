import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderServiceForEdit } from "@/lib/provider/queries/get-provider-service-for-edit";
import { updateService } from "@/lib/provider/update-service";
import { isServiceActionErrorCode, getServiceErrorTranslationKey } from "@/lib/provider/service-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { CategoryField } from "@/components/categories/category-field";

// Edit Experience — Phase 4.2 (Provider Experience), Priority 1. Same
// shape as the Create page, pre-filled with the real bilingual values
// via getProviderServiceForEdit() (not getProviderServiceDetail(),
// which discards "en" — see that query's own note).

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
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let service;
  try {
    service = await getProviderServiceForEdit(id);
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

  const errorMessage = error && isServiceActionErrorCode(error) ? t(getServiceErrorTranslationKey(error)) : null;

  // Selectable set is scoped to THIS service's own serviceType (never a literal).
  const categoryTree = await getSelectableCategories(service.serviceType);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href={`/provider/services/${id}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("editExperienceTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateService(id, formData);
            if (!result.ok) {
              redirect({ href: `/provider/services/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/services/${id}`, locale });
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
                defaultValue={service.nameAr}
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
                defaultValue={service.nameEn}
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
                defaultValue={service.descriptionAr}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("descriptionEnLabel")}</span>
              <textarea
                name="descriptionEn"
                rows={3}
                dir="ltr"
                defaultValue={service.descriptionEn}
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

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("editSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
