import type { ReactNode } from "react";

/** Story canvas: the page background, 16 px phone gutter, a readable column on desktop. */
export function Canvas({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className={`mx-auto flex flex-col gap-4 ${wide ? "max-w-5xl" : "max-w-[26rem]"}`}>{children}</div>
    </main>
  );
}

/** A labelled specimen inside a states grid (label is documentation, not product copy). */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span dir="ltr" className="text-[0.8125rem] font-semibold uppercase tracking-wide text-foreground/70">
        {label}
      </span>
      {children}
    </div>
  );
}
