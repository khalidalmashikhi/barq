import { Link } from "@/i18n/navigation";
import { UserRound } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/customers/[id] — Admin Operations
// Platform. Mirrors admin/providers/[id]/not-found.tsx's convention.

export default async function CustomerNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <UserRound size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("customerNotFoundMessage")}</p>
      <Link
        href="/admin/customers"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToCustomersLabel")}
      </Link>
    </div>
  );
}
