import { useId, type ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";
import { TEXT } from "../tokens";

// Proposed SectionCard: a card is ONE task or ONE section — never a single field, never inside another
// card. Inside, content is separated by rows/dividers (see ValueRow, SensitiveDataRow).

export function SectionCard({ title, icon, badge, action, children, className }: { title: ReactNode; icon?: ReactNode; badge?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={clsx("flex flex-col gap-4 rounded-[1.25rem] border border-foreground/10 bg-card p-5", className)}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {icon && <span className="shrink-0 text-primary">{icon}</span>}
        <h2 id={id} className={clsx(TEXT.heading, "min-w-0 flex-1")}>
          {title}
        </h2>
        {badge}
        {action}
      </div>
      {children}
    </section>
  );
}

/** Rows inside a SectionCard: dividers between items, no nested boxes. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-foreground/10 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&>*]:py-3.5">{children}</div>;
}
