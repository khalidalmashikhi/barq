import { Link } from "@/i18n/navigation";
import { FolderTree } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/categories/[id] — Phase 1.2 (Category
// Admin UI). Mirrors provider/services/[id]/not-found.tsx's convention:
// renders inside the real AppShell (unlike admin/layout.tsx's own RBAC
// notFound(), which escapes the shell entirely).

export default async function CategoryNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <FolderTree size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("categoryNotFoundMessage")}</p>
      <Link
        href="/admin/categories"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToCategoriesLabel")}
      </Link>
    </div>
  );
}
