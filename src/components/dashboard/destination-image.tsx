"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { BrandPattern, type BrandPatternTone } from "@/components/ui/brand-pattern";

// Image manifest + fallback-safe image component — Visual Identity
// Redesign, real-photography pass.
//
// *** REAL PHOTOGRAPHY IS NOT INCLUDED — NONE EXISTS IN THIS SANDBOX ***
// Explicit instruction this turn was "do NOT use placeholders, use
// beautiful tourism photos... from Unsplash." Unsplash's no-API-key
// hotlink pattern (source.unsplash.com) is being actively shut down —
// confirmed via search, not assumed — so no production code here
// depends on it. The real Unsplash API requires an API key from their
// own developer registration, which I cannot generate. What this
// component actually does: reference real local file paths
// (/public/images/...) that you place real photos at — once a photo
// exists at the listed path, it renders correctly with zero code
// changes. Until then, it shows a deliberate brand-patterned fallback
// (BrandPattern + a muted icon) rather than a fake gradient dressed up
// to look like a photo — the fallback state is honest about being a
// fallback, not a disguised placeholder.
//
// Suggested real photos to search for and download from Unsplash's own
// site (unsplash.com, browsing/downloading directly, not hotlinking) or
// your own photography, saved at the paths below:
//
// DESTINATION_IMAGES itself now lives in ./destination-images.ts (a
// plain, non-"use client" data module) — see that file's own comment
// for why a Server Component importing it from here (a "use client"
// file) would receive undefined for every value. Re-exported here
// unchanged so existing imports from this file keep working.

export { DESTINATION_IMAGES } from "./destination-images";

type DestinationImageProps = {
  src: string;
  alt: string;
  className?: string;
  tone?: BrandPatternTone;
};

export function DestinationImage({ src, alt, className, tone = "navy" }: DestinationImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`relative flex items-center justify-center overflow-hidden bg-accent/10 text-primary/25 ${className ?? ""}`}>
        <BrandPattern tone={tone} className="absolute inset-0" />
        <ImageIcon size={28} strokeWidth={1.5} className="relative" />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      style={{ objectFit: "cover" }}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
