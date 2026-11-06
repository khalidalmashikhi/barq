import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { clsx } from "@/components/ui/clsx";

// Proposed Alert ("Notice"): one sentence, icon, optional action. danger is role="alert" (announced at
// once); the others are role="status" (polite).

export type NoticeTone = "info" | "warning" | "danger" | "success";

const STYLE: Record<NoticeTone, { box: string; Icon: typeof Info }> = {
  info: { box: "bg-[#EEF4F8] text-[#062F49]", Icon: Info },
  warning: { box: "bg-[#FFF6E5] text-[#7A4A00]", Icon: AlertTriangle },
  danger: { box: "bg-[#FEF2F2] text-[#B91C1C]", Icon: XCircle },
  success: { box: "bg-[#ECFDF3] text-[#15803D]", Icon: CheckCircle2 },
};

export function Notice({ tone = "info", title, children, action, className }: { tone?: NoticeTone; title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  const { box, Icon } = STYLE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[1rem] leading-[1.6]", box, className)}>
      <Icon strokeWidth={2} aria-hidden className="ds-icon-sm mt-[0.2em] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}
