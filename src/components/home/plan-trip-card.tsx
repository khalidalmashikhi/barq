import { Map as MapIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// 2026-10-17 — Trip planner entry point on the customer Home ("خطط رحلتك" / "Plan your trip").
// A plain link to the public planner page — no data, no request, nothing provider-related.

export async function PlanTripCard() {
  const t = await getServerTranslator("trips");
  return (
    <section aria-labelledby="plan-trip-title" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-secondary/30 bg-secondary/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-secondary-700 shadow-sm">
            <MapIcon size={24} strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-1">
            <h2 id="plan-trip-title" className="text-xl font-semibold text-foreground">
              {t("homeCardTitle")}
            </h2>
            <p className="text-sm text-foreground/75">{t("homeCardBody")}</p>
          </div>
        </div>
        <Link href="/trips" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2">
          {t("homeCardCta")}
        </Link>
      </div>
    </section>
  );
}
