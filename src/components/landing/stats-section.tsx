import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getPlatformStats } from "@/lib/services/get-platform-stats";

// BARQ in Numbers — Phase F.1, landing page section 9. Real counts
// (getPlatformStats()) — no fabricated marketing numbers. Destinations
// covered and happy travelers are honestly framed against what the
// platform can actually claim today (a fixed count of Oman
// destinations this launch covers; real published/approved counts for
// the rest) rather than inventing unverifiable figures.

export async function StatsSection() {
  const t = await getServerTranslator("landing");
  const stats = await getPlatformStats();

  const items = [
    { label: t("stats.experiencesLabel"), value: stats.publishedServicesCount },
    { label: t("stats.providersLabel"), value: stats.approvedProvidersCount },
  ];

  return (
    <section className="bg-luxury-gradient px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-white sm:text-3xl">{t("stats.title")}</h2>

        <div className="grid grid-cols-2 gap-6 text-center">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <span className="text-4xl font-bold text-white sm:text-5xl">{item.value}</span>
              <span className="text-sm text-white/70">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
