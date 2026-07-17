import { HeartOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Favorites (❤️) — no Favorites/SavedExperience data model exists in
// BARQ's schema. Per explicit instruction, this is NOT backed by
// fabricated example data — it's an honest empty state. Adding a real
// Favorites model would be a schema change; not made in this sprint
// per explicit "do not add schema fields unless you STOP and explain."

export async function FavoritesSection() {
  const t = await getServerTranslator("dashboard");

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>❤️</span>
        {t("favoritesTitle")}
      </h2>
      <EmptyState icon={HeartOff} message={t("favoritesUnavailableLabel")} />
    </div>
  );
}
