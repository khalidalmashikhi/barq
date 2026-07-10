import { Sparkles } from "lucide-react";

// Recommended (✨ موصى به لك) — this section explicitly claims
// personalization ("for you"), which requires a recommendation engine
// that does not exist in BARQ — a real business feature, not something
// this sprint's scope (dashboard data wiring) covers. Distinct from
// PopularDestinations, which is static informational content about
// real Omani places, not a personalization claim. Honest empty state
// here rather than generic content dressed up as personalized.

export function RecommendedSection() {
  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>✨</span>
        موصى به لك
      </h2>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <Sparkles size={28} strokeWidth={1.5} className="text-foreground/25" />
        <p className="text-sm text-foreground/50">التوصيات الشخصية قيد التطوير</p>
      </div>
    </div>
  );
}
