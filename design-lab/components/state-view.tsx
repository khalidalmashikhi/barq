import type { ReactNode } from "react";
import { CheckCircle2, FileText, SearchX, XCircle } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { TEXT } from "../tokens";

// Proposed StateView: Loading (skeleton + one honest sentence, no fake percentage, polite live region),
// Empty (what is missing + ONE next step), Error (what failed, that nothing was lost, retry),
// Success (what happened and what happens next — e.g. "under BARQ review", never "approved").

export type StateKind = "loading" | "empty" | "error" | "success";

const ICON = { empty: SearchX, error: XCircle, success: CheckCircle2, loading: FileText } as const;
const ICON_COLOR = { empty: "text-foreground/60", error: "text-[#B91C1C]", success: "text-[#15803D]", loading: "text-primary" } as const;

export function StateView({ kind, title, body, action, secondaryAction }: { kind: StateKind; title: ReactNode; body?: ReactNode; action?: ReactNode; secondaryAction?: ReactNode }) {
  const Icon = ICON[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={kind === "loading" || undefined}
      className="flex flex-col items-center gap-3 rounded-[1.25rem] border border-foreground/10 bg-card px-5 py-7 text-center"
    >
      <Icon strokeWidth={1.6} aria-hidden className={clsx("ds-icon-xl", ICON_COLOR[kind], kind === "loading" && "motion-safe:animate-pulse")} />
      <p className={TEXT.heading}>{title}</p>
      {body && <p className={TEXT.support}>{body}</p>}
      {kind === "loading" && (
        <div aria-hidden className="flex w-full flex-col items-center gap-2 pt-1">
          <span className="h-3.5 w-full rounded-md bg-foreground/10 motion-safe:animate-pulse" />
          <span className="h-3.5 w-3/4 rounded-md bg-foreground/10 motion-safe:animate-pulse" />
        </div>
      )}
      {action && <div className="flex w-full flex-col items-stretch pt-1">{action}</div>}
      {secondaryAction}
    </div>
  );
}

/** Skeleton block for loading layouts. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("block rounded-lg bg-foreground/10 motion-safe:animate-pulse", className)} />;
}
