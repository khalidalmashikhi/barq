import { Search, CalendarCheck, Sparkles } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// How BARQ Works — Phase F.1, landing page section 7.

const steps = [
  { key: "step1", icon: Search },
  { key: "step2", icon: CalendarCheck },
  { key: "step3", icon: Sparkles },
] as const;

export async function HowItWorksSection() {
  const t = await getServerTranslator("landing");

  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-12 flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("howItWorks.title")}</h2>
        <p className="max-w-xl text-foreground/60">{t("howItWorks.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
        {steps.map(({ key, icon: Icon }, index) => (
          <div key={key} className="relative flex flex-col items-center gap-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Icon size={26} strokeWidth={1.75} />
            </span>
            <span className="absolute -top-2 start-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <h3 className="text-lg font-semibold text-foreground">{t(`howItWorks.${key}Title`)}</h3>
            <p className="max-w-xs text-sm leading-relaxed text-foreground/60">
              {t(`howItWorks.${key}Description`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
