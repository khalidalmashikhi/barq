import { useEffect, useRef, type ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";

// Proposed StickyActionBar for task screens: ONE primary action, at most one quiet action, and a status
// line saying what is still missing (instead of a disabled button with no reason). Task screens show no
// bottom navigation, so there are never two stacked bottom bars.
//
// LARGE TEXT (150 % / 200 % on a phone — see design-lab/lab.css):
//   mode "A" (chosen, 2026-10-26): only the primary action stays sticky; the status line and the
//            secondary action are hidden here and rendered in the page's action area instead
//            (TaskShell `inlineActions`); the disabled reason stays announced via aria-describedby;
//   mode "B" (measured alternative): the bar stops being sticky; everything sits at the end of the page.
// Bottom padding honours the iPhone home indicator (env(safe-area-inset-bottom)); `--ds-test-safe-bottom`
// lets the Chromium layout tests emulate that inset (env() is 0 there). The bar publishes its height
// as --ds-bottom-h while it is sticky, so focus / anchor scrolling keeps targets above it.

export type BarMode = "A" | "B";

export function StickyActionBar({ status, primary, secondary, mode = "A", className }: { status?: ReactNode; primary: ReactNode; secondary?: ReactNode; mode?: BarMode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => {
      // a copy that is not rendered (e.g. the desktop side panel on a phone) publishes nothing
      if (el.getClientRects().length === 0) return;
      const sticky = getComputedStyle(el).position === "sticky";
      root.style.setProperty("--ds-bottom-h", sticky ? `${Math.ceil(el.getBoundingClientRect().height)}px` : "0px");
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    observer.observe(root);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--ds-bottom-h");
    };
  }, []);

  const hideWhenLarge = mode === "A" ? "ds-hide-large" : undefined;
  return (
    <div
      ref={ref}
      data-ds-sticky-bar=""
      data-mode={mode}
      className={clsx(
        // compact spacing (2026-10-31): the consent bar with a two-line disabled reason stays ≤ 25 % at 375 × 812
        "sticky bottom-0 z-10 flex flex-col gap-1 border-t border-foreground/10 bg-card/95 px-4 pt-2 backdrop-blur",
        "pb-[max(env(safe-area-inset-bottom),var(--ds-test-safe-bottom,0px),0.75rem)]",
        className,
      )}
    >
      {status && (
        <p role="status" className={clsx("text-center text-[0.9375rem] leading-[1.5] text-foreground/70", hideWhenLarge)}>
          {status}
        </p>
      )}
      {primary}
      {secondary && <div className={clsx("flex justify-center", hideWhenLarge)}>{secondary}</div>}
    </div>
  );
}
