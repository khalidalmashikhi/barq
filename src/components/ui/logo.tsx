"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

// Logo component — Brand Identity Reset (2026-07), Phase 2: Official
// Logo Integration.
//
// REPLACES the prior SVG-then-PNG-fallback logic (which existed only
// because of a real, then-unresolved conflict over which asset file
// was current) — that ambiguity is gone now that the two definitive,
// official exports below exist. No runtime fallback/onError handling
// is needed anymore.
//
// *** DOES NOT INCLUDE ANY LOGO ARTWORK ***. Both files referenced
// below are mechanical crops of the single official source
// (public/Barqlogo.png) — nothing was redrawn, recolored, or
// recreated. See public/branding/ for the crop methodology.
//
// Three variants, chosen per placement by the caller (not auto-detected):
// - "mark": icon-only, no wordmark/tagline — legible at small/compact
//   sizes (sidebars, dashboard top bar, mobile drawers). This is the
//   default, matching how every existing call site used this
//   component before the brand reset (icon-only, no lockup).
// - "wordmark": icon + Arabic wordmark "برق" (no tagline, no flight
//   motif) — a mechanical crop of "full" with the bottom
//   tagline/airplane band removed. Added in the Phase 2 navbar
//   revision specifically for the public navbar, where a larger icon
//   alone still only reads as an abstract shape — the wordmark gives
//   the mark an actual, legible brand name at a size a navbar can
//   afford, without the tagline's small text needing to be legible at
//   that scale.
// - "full": the complete lockup (icon + Arabic wordmark + tagline +
//   flight motif) — only legible where real space exists (the login
//   page's card placement). Never use "full" or "wordmark" under a
//   filter like `brightness-0 invert` — the fine wordmark detail does
//   not survive being flattened to a solid silhouette; use "mark" for
//   any inverted/silhouette placement instead.
//
// Uses Next.js Image with base className="w-auto object-contain" —
// width/height props are the asset's real intrinsic dimensions (so
// Next.js can prevent layout shift), and every caller supplies its own
// explicit height utility (h-7, h-16, etc.) to set the actual rendered
// size, with width deriving proportionally via object-contain.
//
// DELIBERATELY NO "h-auto" IN THE BASE CLASSES: a real bug, found
// during Phase 2's live verification — Tailwind's compiled stylesheet
// does not order utilities by where they appear in a class string, so
// "h-auto" (base) vs. a caller's "h-7" (appended after it in the
// string) is decided by Tailwind's own internal utility ordering, not
// string order — and "h-auto" was winning, rendering every Logo at its
// full intrinsic pixel size instead of the intended compact height.
// Every current call site already provides its own explicit height
// utility, so the base classes simply don't need to include one.

type LogoVariant = "mark" | "wordmark" | "full";

type LogoProps = {
  className?: string;
  variant?: LogoVariant;
};

const LOGO_VARIANTS: Record<LogoVariant, { src: string; width: number; height: number }> = {
  mark: { src: "/branding/barq-mark.png", width: 358, height: 680 },
  wordmark: { src: "/branding/barq-logo-icon-wordmark.png", width: 1186, height: 465 },
  full: { src: "/branding/barq-logo-full.png", width: 1186, height: 680 },
};

export function Logo({ className, variant = "mark" }: LogoProps) {
  const t = useTranslations("common");
  const { src, width, height } = LOGO_VARIANTS[variant];

  return (
    <Image
      src={src}
      alt={t("appName")}
      width={width}
      height={height}
      className={`w-auto object-contain ${className ?? ""}`.trim()}
      priority
    />
  );
}
