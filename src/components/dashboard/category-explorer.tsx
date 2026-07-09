import { Mountain, Waves, Compass, Car, Tent, Camera } from "lucide-react";

// Explore-by-category section — new component. Visually complete but
// not wired to real filtering/navigation yet (no Experience/Category
// data model exists in this project) — consistent with this project's
// standing honesty practice, documented here in code, not surfaced as
// a visible "placeholder" label in the rendered UI, per this turn's
// explicit request for the interface itself to look finished.

const categories = [
  { label: "جبال", icon: Mountain },
  { label: "شواطئ", icon: Waves },
  { label: "مغامرات", icon: Compass },
  { label: "نقل", icon: Car },
  { label: "تخييم", icon: Tent },
  { label: "تصوير", icon: Camera },
];

export function CategoryExplorer() {
  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🧭</span>
        استكشف حسب الفئة
      </h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.label}
              type="button"
              className="group flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-premium"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/30 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon size={20} strokeWidth={1.75} />
              </div>
              <span className="text-xs font-medium text-foreground/70">{category.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
