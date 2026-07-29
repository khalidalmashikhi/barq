import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Final CTA — Phase F.1, landing page section 12.

export async function CtaSection() {
  const t = await getServerTranslator("landing");

  return (
    <section className="px-6 py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 rounded-3xl bg-luxury-gradient p-12 text-center shadow-premium-lg sm:p-16">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("cta.title")}</h2>
        <p className="max-w-lg text-white/75">{t("cta.subtitle")}</p>
        <Link
          href="/login"
          className="rounded-full bg-white px-8 py-3.5 text-sm font-medium text-primary shadow-premium transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {t("cta.button")}
        </Link>
      </div>
    </section>
  );
}
