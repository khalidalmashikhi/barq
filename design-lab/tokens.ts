// BARQ design lab — PROPOSED type scale and status tones (2026-10-24). Lab-only class constants on top
// of the existing Tailwind tokens (primary / secondary-700 / warning / success / danger / foreground
// tiers); nothing here changes the app. All sizes are rem so the 150 % / 200 % text settings scale them.
//
// Proposal vs today: one scale on every viewport (today the desktop tokens drop body text to 16 px and
// helper text to 15 px); body 18 px, never below 15 px; Arabic leading ≥ 1.6.

export const TEXT = {
  display: "text-[1.875rem] leading-[1.35] font-bold text-primary",
  title: "text-[1.625rem] leading-[1.4] font-bold text-primary",
  heading: "text-[1.25rem] leading-[1.5] font-semibold text-foreground",
  body: "text-[1.125rem] leading-[1.7] text-foreground",
  label: "text-[1.0625rem] leading-[1.5] font-semibold text-foreground",
  support: "text-[1rem] leading-[1.65] text-foreground/70",
  caption: "text-[0.9375rem] leading-[1.5] text-foreground/70",
} as const;

/**
 * Status tones — always an icon AND a word, never colour alone. Text/background pairs measured ≥ 4.5:1:
 * review #7A4A00 on #FFF6E5 (≈ 7.6:1) · ok #15803D on #ECFDF3 (≈ 4.9:1) · missing #B91C1C on #FEF2F2
 * (≈ 5.9:1) · private navy on #EEF4F8 · neutral #475569 on #EEF1F4 (≈ 6.6:1) · teal #077588 (secondary-700)
 * on #E8F8F6 (≈ 5.0:1). Orange (accent) stays brand-only and is never a status.
 */
// `edge` is a 3 px bar drawn with ::before at the card's inline-start padding (a border would be
// overridden by the row dividers' colour).
const EDGE = "relative before:absolute before:inset-y-3 before:-start-5 before:w-[3px] before:rounded-full";

export const TONE = {
  review: { badge: "bg-[#FFF6E5] text-[#7A4A00]", edge: `${EDGE} before:bg-warning`, text: "text-[#7A4A00]" },
  ok: { badge: "bg-[#ECFDF3] text-[#15803D]", edge: "", text: "text-[#15803D]" },
  missing: { badge: "bg-[#FEF2F2] text-[#B91C1C]", edge: `${EDGE} before:bg-danger`, text: "text-[#B91C1C]" },
  private: { badge: "bg-[#EEF4F8] text-primary", edge: "", text: "text-primary" },
  neutral: { badge: "bg-[#EEF1F4] text-[#475569]", edge: "", text: "text-[#475569]" },
  teal: { badge: "bg-[#E8F8F6] text-secondary-700", edge: "", text: "text-secondary-700" },
} as const;

export type Tone = keyof typeof TONE;

export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2";

/**
 * Documentation-only forced visual state, so a story can SHOW hover / focus / pressed without a pointer
 * (Playwright separately drives the real :hover / :focus-visible / :active in the visual tests).
 */
export type ForcedState = "hover" | "focus" | "pressed";
