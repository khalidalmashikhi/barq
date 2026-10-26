import type { ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";

// Proposed StickyActionBar for task screens: ONE primary action, at most one quiet action, and a status
// line saying what is still missing (instead of a disabled button with no reason). Honors the iPhone
// home-indicator inset (env(safe-area-inset-bottom), as the current bar already does). Task screens
// show no bottom navigation, so there are never two stacked bottom bars.

export function StickyActionBar({ status, primary, secondary, className }: { status?: ReactNode; primary: ReactNode; secondary?: ReactNode; className?: string }) {
  return (
    <div className={clsx("sticky bottom-0 z-10 flex flex-col gap-1.5 border-t border-foreground/10 bg-card/95 px-4 pt-3 backdrop-blur pb-[max(env(safe-area-inset-bottom),0.75rem)]", className)}>
      {status && (
        <p role="status" className="text-center text-[0.9375rem] leading-[1.5] text-foreground/70">
          {status}
        </p>
      )}
      {primary}
      {secondary && <div className="flex justify-center">{secondary}</div>}
    </div>
  );
}
