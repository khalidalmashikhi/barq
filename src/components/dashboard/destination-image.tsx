"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";

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
// changes. Until then, it shows a quiet, neutral fallback (a muted
// icon on a solid tint) rather than a fake gradient dressed up to look
// like a photo — the fallback state is honest about being a fallback,
// not a disguised placeholder.
//
// Suggested real photos to search for and download from Unsplash's own
// site (unsplash.com, browsing/downloading directly, not hotlinking) or
// your own photography, saved at the paths below:

export const DESTINATION_IMAGES = {
  salalah: "/images/salalah.jpg",
  jebelAkhdar: "/images/jebel-akhdar.jpg",
  wadiDarbat: "/images/wadi-darbat.jpg",
  sharqiyaSands: "/images/sharqiya-sands.jpg",
  musandam: "/images/musandam.jpg",
  misfatAlAbriyeen: "/images/misfat-al-abriyeen.jpg",
  nizwa: "/images/nizwa.jpg",
  mughsail: "/images/mughsail.jpg",
  rasAlJinz: "/images/ras-al-jinz.jpg",
} as const;

type DestinationImageProps = {
  src: string;
  alt: string;
  className?: string;
};

export function DestinationImage({ src, alt, className }: DestinationImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-accent/15 text-primary/25 ${className ?? ""}`}>
        <ImageIcon size={28} strokeWidth={1.5} />
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
