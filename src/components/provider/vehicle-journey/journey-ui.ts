// 2026-10-16 vehicle-journey visual checkpoint — the ONLY visual primitives of the document-first
// journey (upload → reading → review). They package existing design tokens (navy `primary`, teal
// `secondary`, amber `warning`, the shared type scale and `border` / `card` / `background`) into a few
// class constants, so the three screens look like one product without becoming a second design
// system. Nothing here carries behaviour.

/** Centered journey column: calm on desktop (~832 px), 16 px gutters on a phone. */
export const JOURNEY_PAGE = "mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 pb-40 pt-5 sm:px-6 sm:pt-8";

/** The one card surface: white, hairline border, 24 px radius, 20 px padding — no heavy shadow. */
export const JOURNEY_CARD = "rounded-3xl border border-border bg-card p-5 sm:p-6";

/** A quieter inset panel inside a card (comparison text, privacy details) — never a card in a card. */
export const JOURNEY_PANEL = "rounded-2xl border border-border bg-background p-4";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50";

/** Strong navy primary action — visibly disabled (not merely faded) when it cannot be used. */
export const JOURNEY_PRIMARY = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-foreground/15 disabled:text-foreground/60 ${FOCUS}`;

/** Quiet secondary action: outlined, same height. */
export const JOURNEY_SECONDARY = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-card px-5 text-base font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** Tertiary text action (cancel, change). */
export const JOURNEY_TERTIARY = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-base font-medium text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** Small in-card action (replace, remove, reveal) — still a 44 px target. */
export const JOURNEY_SMALL = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** Status chips: teal = document-assisted suggestion; amber = genuinely needs review; neutral = info. */
export const JOURNEY_CHIP_SUGGESTION = "inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2.5 py-0.5 text-xs font-medium text-secondary-700";
export const JOURNEY_CHIP_REVIEW = "inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-foreground";
export const JOURNEY_CHIP_NEUTRAL = "inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs font-medium text-foreground/70";
