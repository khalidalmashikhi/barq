import { HeartOff } from "lucide-react";

// Favorites (❤️) — no Favorites/SavedExperience data model exists in
// BARQ's schema. Per explicit instruction, this is NOT backed by
// fabricated example data — it's an honest empty state. Adding a real
// Favorites model would be a schema change; not made in this sprint
// per explicit "do not add schema fields unless you STOP and explain."

export function FavoritesSection() {
  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>❤️</span>
        المفضلة
      </h2>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <HeartOff size={28} strokeWidth={1.5} className="text-foreground/25" />
        <p className="text-sm text-foreground/50">ميزة المفضلة غير متوفرة بعد</p>
      </div>
    </div>
  );
}
