import type { ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";

type SectionBandTone = "white" | "sand";

type SectionBandProps = {
  tone?: SectionBandTone;
  children: ReactNode;
  className?: string;
};

const TONE_CLASSES: Record<SectionBandTone, string> = {
  white: "bg-background",
  sand: "bg-muted/10",
};

// Alternating section background wrapper — Phase 3 Wave 2, addressing
// "the landing page feels flat" feedback. Previously, alternating
// sections used `bg-accent/5` internally — a near-invisible 5% tint of
// `accent`, which maps to the brand's Orange, not Sand — visually
// indistinguishable from the default background at a glance. This
// centralizes the alternation here using the actual Sand brand token
// (`muted`) at a genuinely visible 10% tint, so scrolling the page
// reads as an intentional editorial rhythm rather than a flat, uniform
// grey. Sections keep their own text/foreground styling unchanged —
// this only ever swaps the background.
export function SectionBand({ tone = "white", children, className }: SectionBandProps) {
  return <div className={clsx(TONE_CLASSES[tone], className)}>{children}</div>;
}
