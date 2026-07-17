import { Sparkles } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Recommended (✨ موصى به لك) — this section explicitly claims
// personalization ("for you"), which requires a recommendation engine
// that does not exist in BARQ — a real business feature, not something
// this sprint's scope (dashboard data wiring) covers. Distinct from
// PopularDestinations, which is static informational content about
// real Omani places, not a personalization claim. Honest empty state
// here rather than generic content dressed up as personalized.

export async function RecommendedSection() {
  const t = await getServerTranslator("dashboard");

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>✨</span>
        {t("recommendedTitle")}
      </h2>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <Sparkles size={28} strokeWidth={1.5} className="text-foreground/25" />
        <p className="text-sm text-foreground/50">{t("recommendedUnavailableLabel")}</p>
      </div>
    </div>
  );
}
