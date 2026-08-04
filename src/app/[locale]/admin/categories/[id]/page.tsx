import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Layers, Plus, ArrowUp, ArrowDown, Edit } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCategoryDetail } from "@/lib/categories/get-category-detail";
import { setCategoryVisibility, archiveCategory } from "@/lib/categories/transition-category-visibility";
import { moveCategoryUp, moveCategoryDown } from "@/lib/categories/reorder-category";
import { getCategoryVisibilityStyle, getCategoryVisibilityTranslationKey } from "@/lib/categories/presentation/category-visibility";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { isValidUuid } from "@/lib/uuid";
import { isCategoryActionErrorCode, getCategoryErrorTranslationKey } from "@/lib/categories/category-errors";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Category detail — Phase 1.2 (Category Admin UI). Full visibility
// control (all 6 BR-004 states + schedule date) lives here, not in the
// list row, since it needs a select + optional datetime input; the list
// row keeps a single one-click Archive quick action, mirroring
// admin/providers/page.tsx's single-action-per-row convention.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const VISIBILITY_STATUSES: CategoryVisibilityStatus[] = ["PUBLIC", "HIDDEN", "LINK_ONLY", "INVITE_ONLY", "SCHEDULED", "ARCHIVED"];

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function CategoryDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let category;
  try {
    category = await getCategoryDetail(id);
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

  if (!category) {
    notFound();
  }

  const errorMessage = error && isCategoryActionErrorCode(error) ? t(getCategoryErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/categories" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToCategoriesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{category.name.en}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">/{category.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${getCategoryVisibilityStyle(category.visibilityStatus)}`}>
            {t(getCategoryVisibilityTranslationKey(category.visibilityStatus))}
          </span>
          <Link
            href={`/admin/categories/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Edit size={14} strokeWidth={1.75} />
            {t("editCategoryButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("visibilityControlTitle")}</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            const targetStatus = formData.get("visibilityStatus") as CategoryVisibilityStatus;
            const scheduledRaw = formData.get("scheduledVisibleAt");
            const scheduledVisibleAt =
              typeof scheduledRaw === "string" && scheduledRaw ? new Date(scheduledRaw) : undefined;
            const result = await setCategoryVisibility(id, targetStatus, scheduledVisibleAt);
            if (!result.ok) {
              redirect({ href: `/admin/categories/${id}?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/categories/${id}`, locale });
          }}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("visibilityControlTitle")}</span>
            <select
              name="visibilityStatus"
              defaultValue={category.visibilityStatus}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {VISIBILITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(getCategoryVisibilityTranslationKey(status))}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("scheduledVisibleAtLabel")}</span>
            <input
              type="datetime-local"
              name="scheduledVisibleAt"
              defaultValue={category.scheduledVisibleAt ? category.scheduledVisibleAt.toISOString().slice(0, 16) : undefined}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {t("setVisibilityButton")}
          </SubmitButton>
        </form>

        {category.visibilityStatus !== "ARCHIVED" && (
          <form
            action={async () => {
              "use server";
              const result = await archiveCategory(id);
              if (!result.ok) {
                redirect({ href: `/admin/categories/${id}?error=${result.error}`, locale });
                return;
              }
              redirect({ href: `/admin/categories/${id}`, locale });
            }}
            className="mt-4"
          >
            <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
              {t("archiveCategoryButton")}
            </SubmitButton>
          </form>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t("subcategoriesLabel")}</h2>
        <Link
          href={`/admin/categories/${id}/subcategories/new`}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createSubcategoryButton")}
        </Link>
      </div>

      {category.children.length === 0 ? (
        <EmptyState icon={Layers} message={t("noSubcategoriesLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {category.children.map((child) => (
            <div key={child.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{child.name.en}</p>
                <p className="mt-0.5 text-xs text-foreground/40">/{child.slug}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getCategoryVisibilityStyle(child.visibilityStatus)}`}>
                  {t(getCategoryVisibilityTranslationKey(child.visibilityStatus))}
                </span>
                {!child.effectivelyVisible && child.visibilityStatus === "PUBLIC" && (
                  <span className="text-xs text-foreground/40">{t("hiddenByParentLabel")}</span>
                )}

                {/* Child categories use the SAME Category actions as roots
                    (ADR-0015); reorder is sibling-scoped by parentId. */}
                <form
                  action={async () => {
                    "use server";
                    await moveCategoryUp(child.id);
                    redirect({ href: `/admin/categories/${id}`, locale });
                  }}
                >
                  <SubmitButton aria-label={t("moveUpLabel")} className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50">
                    <ArrowUp size={16} strokeWidth={1.75} />
                  </SubmitButton>
                </form>
                <form
                  action={async () => {
                    "use server";
                    await moveCategoryDown(child.id);
                    redirect({ href: `/admin/categories/${id}`, locale });
                  }}
                >
                  <SubmitButton aria-label={t("moveDownLabel")} className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50">
                    <ArrowDown size={16} strokeWidth={1.75} />
                  </SubmitButton>
                </form>

                <Link
                  href={`/admin/categories/${id}/subcategories/${child.id}/edit`}
                  className="rounded-full border border-border p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground"
                  aria-label={t("editSubcategoryButton")}
                >
                  <Edit size={14} strokeWidth={1.75} />
                </Link>

                {child.visibilityStatus !== "ARCHIVED" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await archiveCategory(child.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/categories/${id}?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: `/admin/categories/${id}`, locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                      {t("archiveSubcategoryButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
