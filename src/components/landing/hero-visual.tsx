import Image from "next/image";
import { BrandPattern } from "@/components/ui/brand-pattern";

type HeroVisualProps = {
  photoSrc?: string;
  alt: string;
  caption: string;
};

// The Hero's image panel — Phase 3 Wave 2. Structured exactly as a real
// photo slot: pass `photoSrc` once real Oman photography (mountains,
// wadis, coastline, desert, authentic culture) is available, and it
// renders with zero further code changes, BrandPattern dropping to a
// subtle low-opacity blend overlay on top of the photo. Until then,
// `photoSrc` is intentionally omitted — this renders a clearly-marked
// temporary placeholder (BrandPattern at full weight + an explicit
// "coming soon" caption), never a fabricated stock photo presented as
// authentic Oman photography.
export function HeroVisual({ photoSrc, alt, caption }: HeroVisualProps) {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl shadow-premium-lg sm:aspect-[3/4]">
      {photoSrc ? (
        <>
          <Image src={photoSrc} alt={alt} fill className="object-cover" priority />
          <BrandPattern tone="sand" className="absolute inset-0 opacity-20 mix-blend-overlay" />
        </>
      ) : (
        <>
          <div aria-hidden className="absolute inset-0 bg-luxury-gradient" />
          <BrandPattern tone="sand" className="absolute inset-0" />
          <span className="absolute bottom-4 start-4 rounded-full bg-black/30 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            {caption}
          </span>
        </>
      )}
    </div>
  );
}
