import { Link } from "@/i18n/navigation";
import { Compass } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/services/[id] — Phase 2.4 (Service
// Admin UI). Mirrors admin/providers/[id]/not-found.tsx's convention.

export default async function ServiceNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <Compass size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("serviceNotFoundMessage")}</p>
      <Link
        href="/admin/services"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToServicesLabel")}
      </Link>
    </div>
  );
}
