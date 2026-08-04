import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createCategory } from "@/lib/categories/create-category";
import { isCategoryActionErrorCode, getCategoryErrorTranslationKey } from "@/lib/categories/category-errors";
import { SERVICE_TYPE_KEYS, SERVICE_TYPE_LABEL_KEYS, DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Category — Phase 1.2 (Category Admin UI). Mirrors
// provider/services/new/page.tsx's form shape exactly: bilingual name
// fields, inline Server Action, ?error=CODE round-trip for validation
// feedback (this codebase has no toast/inline-per-field-error system —
// see the module survey this phase's implementation was based on).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewCategoryPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isCategoryActionErrorCode(error) ? t(getCategoryErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/categories" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToCategoriesLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createCategoryTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createCategory(formData);
            if (!result.ok) {
              redirect({ href: `/admin/categories/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/categories/${result.categoryId}`, locale });
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
              placeholder="activities"
              dir="ltr"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("categorySlugHintLabel")}</span>
          </label>

          {/* ServiceType (vertical) — ADR-0015. The option set is the
              code-owned registry (src/lib/service-types), never a hardcoded
              list. A root category chooses its vertical here; child categories
              inherit their parent's and have no selector. */}
          <label className="flex flex-col gap-1.5 sm:w-64">
            <span className="text-xs font-medium text-foreground/50">{t("categoryServiceTypeLabel")}</span>
            <select
              name="serviceTypeKey"
              required
              defaultValue={DEFAULT_SERVICE_TYPE_KEY}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {SERVICE_TYPE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(SERVICE_TYPE_LABEL_KEYS[key])}
                </option>
              ))}
            </select>
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createCategorySubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
