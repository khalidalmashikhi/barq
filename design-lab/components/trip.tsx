import { useId, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { FOCUS_RING, TEXT } from "../tokens";
import { StatusBadge } from "./status-badge";

// Proposed trip-plan pieces. A day is ONE section (TripDayTimeline) whose periods are rows — no card
// inside the day card. Two row kinds, told apart by badge text AND weight:
//   BarqServiceCard        — a service listed on BARQ: title, the existing availability badge
//                            ("checked at booking" / "bookable"), an ESTIMATED cost, view / replace;
//   GeneralSuggestionCard  — a general trip idea: lighter title, "general trip suggestion" badge,
//                            the "not verified, not bookable" note. Never priced, never "available".
// No copy here claims AI, verification or a guarantee; the strings come from trips.json.

const LINK = `inline-flex min-h-11 items-center rounded-lg px-1 text-[1rem] font-semibold underline underline-offset-4 hover:bg-[#EEF4F8] ${FOCUS_RING}`;

export function TripDayTimeline({ title, regenerateLabel, onRegenerate, footer, children }: { title: ReactNode; regenerateLabel: string; onRegenerate?: () => void; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col rounded-[1.25rem] border border-foreground/10 bg-card px-5 pb-4 pt-3">
      <div className="flex items-center gap-2 border-b border-foreground/10 pb-2">
        <h2 id={id} className={clsx(TEXT.heading, "flex-1")}>
          {title}
        </h2>
        <button type="button" onClick={onRegenerate} aria-label={regenerateLabel} title={regenerateLabel} className={`flex size-11 items-center justify-center rounded-xl text-primary hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
          <RefreshCw className="ds-icon" aria-hidden />
        </button>
      </div>
      <ol className="flex flex-col divide-y divide-foreground/10">{children}</ol>
      {footer && <p className="border-t border-foreground/10 pt-3 text-[0.9375rem] leading-[1.5] text-foreground/70">{footer}</p>}
    </section>
  );
}

function SlotRow({ period, children }: { period: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-wrap gap-x-3 gap-y-1 py-3.5">
      <span className="w-16 shrink-0 pt-0.5 text-[0.9375rem] leading-[1.5] text-foreground/70">{period}</span>
      {/* basis (not min-width): at 150 % / 200 % text the content wraps under the period instead of overflowing. */}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">{children}</div>
    </li>
  );
}

export function BarqServiceCard({ period, title, badge, badgeTone = "teal", cost, duration, viewLabel, replaceLabel, href = "#" }: { period: ReactNode; title: ReactNode; badge: ReactNode; badgeTone?: "teal" | "ok"; cost?: ReactNode; duration?: ReactNode; viewLabel: ReactNode; replaceLabel?: ReactNode; href?: string }) {
  return (
    <SlotRow period={period}>
      <h3 className="text-[1.125rem] font-semibold leading-[1.5]">{title}</h3>
      <StatusBadge tone={badgeTone} className="self-start">
        {badge}
      </StatusBadge>
      {(cost || duration) && (
        <p className="text-[0.9375rem] leading-[1.5] text-foreground/70">
          {cost}
          {cost && duration ? " · " : ""}
          {duration}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4">
        <a href={href} className={`${LINK} text-primary`}>
          {viewLabel}
        </a>
        {replaceLabel && (
          <button type="button" className={`${LINK} text-foreground/70`}>
            {replaceLabel}
          </button>
        )}
      </div>
    </SlotRow>
  );
}

export function GeneralSuggestionCard({ period, title, badge, note }: { period: ReactNode; title: ReactNode; badge: ReactNode; note?: ReactNode }) {
  return (
    <SlotRow period={period}>
      <h3 className="text-[1.125rem] font-medium leading-[1.5] text-foreground/70">{title}</h3>
      <StatusBadge tone="neutral" className="self-start">
        {badge}
      </StatusBadge>
      {note && <p className="text-[0.9375rem] leading-[1.5] text-foreground/70">{note}</p>}
    </SlotRow>
  );
}
