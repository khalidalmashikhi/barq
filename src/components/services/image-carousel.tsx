"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "@/components/ui/clsx";

// Reusable image carousel — Phase F.2 (goal 3, Experience Detail Page
// gallery). Generic (not service-specific) so any future page needing
// a real multi-image gallery can reuse it as-is. Only rendered by
// ServiceGallery when 2+ real image URLs are supplied — today no
// caller has any (Service has no image field, see ServiceGallery's own
// comment), so this component exists ready to use, not yet in use.

type ImageCarouselProps = {
  images: string[];
  alt: string;
};

export function ImageCarousel({ images, alt }: ImageCarouselProps) {
  const [active, setActive] = useState(0);
  const activeSrc = images[active] ?? images[0];

  return (
    <div className="relative h-72 overflow-hidden rounded-2xl bg-accent/10 sm:h-96">
      {/* eslint-disable-next-line @next/next/no-img-element -- provider-supplied Supabase host; next/image remotePatterns is a POST-LAUNCH follow-up (Media Foundation, Gap C) */}
      {activeSrc && <img src={activeSrc} alt={alt} className="absolute inset-0 h-full w-full object-cover" />}

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setActive((current) => (current - 1 + images.length) % images.length)}
            aria-label="Previous image"
            className="absolute start-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-foreground backdrop-blur-md transition-colors hover:bg-white"
          >
            <ChevronRight size={18} strokeWidth={1.75} className="rtl:hidden" />
            <ChevronLeft size={18} strokeWidth={1.75} className="hidden rtl:block" />
          </button>
          <button
            type="button"
            onClick={() => setActive((current) => (current + 1) % images.length)}
            aria-label="Next image"
            className="absolute end-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-foreground backdrop-blur-md transition-colors hover:bg-white"
          >
            <ChevronLeft size={18} strokeWidth={1.75} className="rtl:hidden" />
            <ChevronRight size={18} strokeWidth={1.75} className="hidden rtl:block" />
          </button>

          <div className="absolute bottom-3 start-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Go to image ${index + 1}`}
                aria-current={index === active}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  index === active ? "w-5 bg-white" : "w-1.5 bg-white/50"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
