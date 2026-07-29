import { Quote } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Testimonials — Phase F.1, landing page section 10. EXPLICITLY
// PLACEHOLDER per this phase's own requirement #5 ("Testimonials
// (placeholder)") — the two quotes below are illustrative sample
// copy, not real customer reviews (BARQ has no review-collection
// feature yet), and the section visibly discloses this via
// `placeholderNote` rather than presenting invented quotes as genuine
// — consistent with "Trust through clean design."

export async function TestimonialsSection() {
  const t = await getServerTranslator("landing");

  const testimonials = [
    { quoteKey: "quote1", authorKey: "author1" },
    { quoteKey: "quote2", authorKey: "author2" },
  ] as const;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("testimonials.title")}</h2>
        <p className="max-w-xl text-foreground/60">{t("testimonials.subtitle")}</p>
      </div>
      <p className="mb-10 text-center text-xs font-medium uppercase tracking-wide text-accent-foreground/60">
        {t("testimonials.placeholderNote")}
      </p>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {testimonials.map(({ quoteKey, authorKey }) => (
          <figure key={quoteKey} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <Quote size={28} strokeWidth={1.5} className="text-accent" aria-hidden />
            <blockquote className="text-base leading-relaxed text-foreground/80">
              &ldquo;{t(`testimonials.${quoteKey}`)}&rdquo;
            </blockquote>
            <figcaption className="text-sm font-medium text-foreground/50">{t(`testimonials.${authorKey}`)}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
