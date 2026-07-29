import { ShieldCheck, ReceiptText, Zap, Headset } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Why Choose BARQ — Phase F.1, landing page section 8.

const reasons = [
  { key: "trust", icon: ShieldCheck },
  { key: "transparent", icon: ReceiptText },
  { key: "fast", icon: Zap },
  { key: "support", icon: Headset },
] as const;

export async function WhyChooseSection() {
  const t = await getServerTranslator("landing");

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("whyChoose.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("whyChoose.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {reasons.map(({ key, icon: Icon }) => (
            <div key={key} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <h3 className="text-base font-semibold text-foreground">{t(`whyChoose.${key}Title`)}</h3>
              <p className="text-sm leading-relaxed text-foreground/60">{t(`whyChoose.${key}Description`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
