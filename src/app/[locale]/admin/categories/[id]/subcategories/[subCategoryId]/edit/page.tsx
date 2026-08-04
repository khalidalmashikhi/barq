import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCategoryDetail } from "@/lib/categories/get-category-detail";
import { updateCategory } from "@/lib/categories/update-category";
import { isCategoryActionErrorCode, getCategoryErrorTranslationKey } from "@/lib/categories/category-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Edit SubCategory — Phase 1.2 (Category Admin UI). Mirrors
// admin/categories/[id]/edit/page.tsx's shape, one level deeper. Reuses
// getCategoryDetail() (already returns nested subCategories with raw
// bilingual Json) rather than adding a new query — no duplicated
// data-fetching logic for a single-subcategory lookup this phase never
// otherwise needs.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string; subCategoryId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditSubCategoryPage({ params, searchParams }: Props) {
  const { id: categoryId, subCategoryId } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(categoryId) || !isValidUuid(subCategoryId)) {
    notFound();
  }

  let category;
  try {
    category = await getCategoryDetail(categoryId);
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

  // A "sub-category" is a depth-1 child Category (ADR-0015). The route param
  // is kept for backward-compatible URLs; it addresses a child Category record.
  const child = category?.children.find((c) => c.id === subCategoryId);
  if (!category || !child) {
    notFound();
  }

  const errorMessage = error && isCategoryActionErrorCode(error) ? t(getCategoryErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href={`/admin/categories/${categoryId}`} className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {category.name.en}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("editSubcategoryTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateCategory(subCategoryId, formData);
            if (!result.ok) {
              redirect({ href: `/admin/categories/${categoryId}/subcategories/${subCategoryId}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/categories/${categoryId}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("categoryNameArLabel")}</span>
              <input
                type="text"
                name="nameAr"
                required
                dir="rtl"
                defaultValue={child.name.ar}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("categoryNameEnLabel")}</span>
              <input
                type="text"
                name="nameEn"
                required
                dir="ltr"
                defaultValue={child.name.en}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("categorySlugLabel")}</span>
            <input
              type="text"
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              dir="ltr"
              defaultValue={child.slug}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("categorySlugHintLabel")}</span>
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("saveChangesButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
