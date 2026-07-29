import { Link } from "@/i18n/navigation";
import { ToggleLeft } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/feature-flags/[id] — Phase 1.3 (Core
// Business Platform). Mirrors admin/categories/[id]/not-found.tsx's
// convention.

export default async function FeatureFlagNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <ToggleLeft size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("featureFlagNotFoundMessage")}</p>
      <Link
        href="/admin/feature-flags"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToFeatureFlagsLabel")}
      </Link>
    </div>
  );
}
