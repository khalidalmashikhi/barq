// Generic FAQ accordion — Phase F.4 (Help Center). Extracted/
// generalized from the landing page's own faq-section.tsx, which was
// hardcoded to exactly 4 Q&A pairs baked into its own component body
// and a single fixed i18n namespace — not reusable as-is. This version
// is data-driven (plain `{question, answer}[]`) so the same component
// serves the landing page's FAQ section AND the new Help Center pages
// without duplicating the disclosure markup. Native <details>/
// <summary> — zero client JS, keyboard-operable and screen-reader
// -announced with no custom ARIA wiring needed, same as before.

export type FaqItem = {
  question: string;
  answer: string;
};

type FaqAccordionProps = {
  items: FaqItem[];
};

export function FaqAccordion({ items }: FaqAccordionProps) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <details key={index} className="group rounded-2xl border border-border bg-card p-5 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 marker:content-none">
            {item.question}
            <span aria-hidden className="shrink-0 text-lg leading-none text-foreground/40 transition-transform duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-foreground/60">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
