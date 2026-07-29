import { Link } from "@/i18n/navigation";
import { Users } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/providers/[id] — Phase 2.2 (Provider
// Admin UI). Mirrors admin/categories/[id]/not-found.tsx's convention.

export default async function ProviderNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <Users size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("providerNotFoundMessage")}</p>
      <Link
        href="/admin/providers"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToProvidersLabel")}
      </Link>
    </div>
  );
}
