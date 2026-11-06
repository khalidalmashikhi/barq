import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock, MinusCircle, XCircle } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { TONE, type Tone } from "../tokens";

// Proposed StatusBadge: icon + word on a tinted pill; wraps instead of truncating at large text sizes.

const ICON: Record<Tone, typeof Info> = {
  review: AlertTriangle,
  ok: CheckCircle2,
  missing: XCircle,
  private: Lock,
  neutral: MinusCircle,
  teal: Info,
};

export function StatusBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <span className={clsx("inline-flex max-w-full items-start gap-1.5 rounded-full px-3 py-1 text-[0.9375rem] font-semibold leading-[1.45]", TONE[tone].badge, className)}>
      <Icon strokeWidth={2.25} aria-hidden className="ds-icon-sm mt-[0.2em] shrink-0" />
      <span>{children}</span>
    </span>
  );
}
