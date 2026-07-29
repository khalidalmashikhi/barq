export type BrandPatternTone = "navy" | "teal" | "sand";

type BrandPatternProps = {
  tone?: BrandPatternTone;
  className?: string;
};

const TONE_COLORS: Record<BrandPatternTone, string> = {
  navy: "#094367",
  teal: "#077588",
  sand: "#D4A05E",
};

const TONES: BrandPatternTone[] = ["navy", "teal", "sand"];

// Deterministic tone assignment from any stable string (e.g. a service
// id or title) — same input always yields the same tone, so a grid of
// many cards varies visually without any randomness (which would risk
// a server/client hydration mismatch).
export function getBrandPatternTone(seed: string): BrandPatternTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TONES[hash % TONES.length] ?? "navy";
}

// Decorative faceted-gem motif echoing the logo's angular mark. Used as
// the shared "no photo yet" treatment across DestinationImage,
// ExperienceCard, and ServiceGallery's empty state, so a missing image
// reads as a deliberate brand choice rather than an error state — no
// real Oman photography exists yet (see destination-image.tsx), and
// this replaces three previously inconsistent ad-hoc fallbacks with
// one. Purely decorative: always aria-hidden, never carries content.
export function BrandPattern({ tone = "navy", className }: BrandPatternProps) {
  const color = TONE_COLORS[tone];

  return (
    <svg
      aria-hidden
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      className={`h-full w-full ${className ?? ""}`.trim()}
    >
      <rect width="400" height="300" fill={color} opacity="0.06" />
      <path d="M200 40 L280 110 L240 200 L160 200 L120 110 Z" fill={color} opacity="0.14" />
      <path d="M40 220 L140 160 L220 260 L100 300 L0 300 Z" fill={color} opacity="0.1" />
      <path d="M280 140 L400 90 L400 260 L320 300 L260 220 Z" fill={color} opacity="0.08" />
    </svg>
  );
}
