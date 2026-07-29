import { ImageOff } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { ImageCarousel } from "./image-carousel";
import { BrandPattern } from "@/components/ui/brand-pattern";

// Service image gallery — Engineering Sprint (Services Marketplace);
// Phase F.2 made this carousel-ready (goal 3).
//
// *** THIS COMPONENT WILL SHOW THE EMPTY STATE FOR EVERY SERVICE,
// ALWAYS, UNTIL A SCHEMA DECISION IS MADE *** — Service has no image
// field, and no image/gallery model exists anywhere in schema.prisma.
// This is not a bug or an oversight in this component; there is
// nothing for it to read. It now accepts an optional `images` prop and
// renders a real ImageCarousel when 2+ URLs are supplied, or a single
// real image when exactly 1 is — but no current caller passes any, so
// the honest empty state below is what every service actually shows
// today. Swapping in real images later is a data-wiring change at the
// call site, not a new component to build.
//
// To make this real: either add an `images Json` /
// `imageUrls String[]` field to Service, or a dedicated `ServiceImage`
// model (id, serviceId, url, order) if multiple ordered images with
// their own metadata are wanted. Either is a schema change requiring
// its own approval, not made here.

type ServiceGalleryProps = {
  images?: string[];
  alt?: string;
};

export async function ServiceGallery({ images = [], alt }: ServiceGalleryProps) {
  const t = await getServerTranslator("services");

  if (images.length > 0) {
    return <ImageCarousel images={images} alt={alt ?? t("title")} />;
  }

  return (
    <div className="relative flex h-80 flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl border border-border bg-accent/5 text-center sm:h-[28rem]">
      <BrandPattern tone="navy" className="absolute inset-0" />
      <ImageOff size={32} strokeWidth={1.5} className="relative text-foreground/25" />
      <p className="relative text-sm text-foreground/50">{t("noImagesLabel")}</p>
    </div>
  );
}
