import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import type { ForcedState } from "../tokens";

// Proposed Accordion (disclosure): native <details>/<summary> — keyboard and screen-reader behaviour
// come from the platform; the summary is a 52 px target. Used for layered privacy information: a short
// visible summary, the details on demand, the full text in the Privacy Policy.

export function Accordion({ summary, icon, defaultOpen, children, forceState, className }: { summary: ReactNode; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode; forceState?: ForcedState; className?: string }) {
  return (
    <details open={defaultOpen} className={clsx("group border-y border-foreground/10", className)}>
      <summary
        data-force={forceState}
        className={clsx(
          "flex min-h-[3.25rem] cursor-pointer list-none items-center gap-2.5 rounded-lg px-1 text-[1.0625rem] font-semibold text-foreground [&::-webkit-details-marker]:hidden",
          "hover:bg-[#EEF4F8] data-[force=hover]:bg-[#EEF4F8] active:bg-[#DBE7EF] data-[force=pressed]:bg-[#DBE7EF]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 data-[force=focus]:ring-[3px] data-[force=focus]:ring-primary/40",
        )}
      >
        {icon && <span className="shrink-0 text-foreground/70">{icon}</span>}
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown size={20} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2.5 px-1 pb-4 text-[1rem] leading-[1.7] text-foreground/70">{children}</div>
    </details>
  );
}
