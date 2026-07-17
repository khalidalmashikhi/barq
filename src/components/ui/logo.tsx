"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

// Logo component — rebuilt to resolve a real conflict in the
// instructions received across recent turns: one turn confirmed a real
// SVG at /public/logo.svg (with a specific object-contain technique);
// this turn says /public/logo.png instead. Rather than guess, this
// tries the more recently-and-explicitly-confirmed SVG first, and
// falls back to PNG only if the SVG fails to load — covering both
// stated facts rather than silently picking one. Please confirm which
// file actually exists so this fallback logic can be removed in favor
// of a single, known-correct path.
//
// *** DOES NOT INCLUDE ANY LOGO ARTWORK ***. Never generates or
// recreates the mark, per repeated explicit instruction.
//
// Uses Next.js Image with className="h-auto w-auto object-contain" —
// width/height props are required by Next's Image component (to
// prevent layout shift) but are overridden by the className so the
// browser derives the real, undistorted size from the file itself.
// Callers control the rendered size via their own className (e.g. a
// height utility), which combines with this component's own classes.

type LogoProps = {
  className?: string;
};

export function Logo({ className }: LogoProps) {
  const [src, setSrc] = useState("/logo.svg");
  const t = useTranslations("common");

  return (
    <Image
      src={src}
      alt={t("appName")}
      width={200}
      height={200}
      className={`h-auto w-auto object-contain ${className ?? ""}`.trim()}
      priority
      onError={() => {
        if (src !== "/logo.png") {
          setSrc("/logo.png");
        }
      }}
    />
  );
}
