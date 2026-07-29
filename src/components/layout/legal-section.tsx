import type { ReactNode } from "react";

// Legal section — Phase F.4 (Legal Pages). A plain, numbered-heading
// content block reused across Terms/Privacy/Cookies/Booking Policy —
// consistent typography/spacing instead of each page hand-rolling its
// own section markup.

type LegalSectionProps = {
  title: string;
  children: ReactNode;
};

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/70">{children}</div>
    </section>
  );
}
