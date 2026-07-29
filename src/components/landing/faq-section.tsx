import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { FaqAccordion, type FaqItem } from "@/components/ui/faq-accordion";

// FAQ — Phase F.1, landing page section 11. Phase F.4 — now delegates
// its disclosure markup to the generic, data-driven `FaqAccordion`
// (extracted this phase for the new Help Center pages) instead of
// duplicating the same `<details>`/`<summary>` structure — same 4
// Q&A pairs, same "landing" namespace, same visual output.

export async function FaqSection() {
  const t = await getServerTranslator("landing");

  const pairs = [
    { q: "q1", a: "a1" },
    { q: "q2", a: "a2" },
    { q: "q3", a: "a3" },
    { q: "q4", a: "a4" },
  ] as const;

  const items: FaqItem[] = pairs.map(({ q, a }) => ({
    question: t(`faq.${q}`),
    answer: t(`faq.${a}`),
  }));

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("faq.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("faq.subtitle")}</p>
        </div>

        <FaqAccordion items={items} />
      </div>
    </section>
  );
}
