import { ImageOff } from "lucide-react";

// Service image gallery — Engineering Sprint (Services Marketplace).
//
// *** THIS COMPONENT WILL SHOW THE EMPTY STATE FOR EVERY SERVICE,
// ALWAYS, UNTIL A SCHEMA DECISION IS MADE *** — Service has no image
// field, and no image/gallery model exists anywhere in schema.prisma.
// This is not a bug or an oversight in this component; there is
// nothing for it to read. Built as its own component (rather than
// skipped entirely) so the real gallery slot exists in the layout and
// swapping in real images later is a data-wiring change, not a new
// component to build from scratch.
//
// To make this real: either add an `images Json` /
// `imageUrls String[]` field to Service, or a dedicated `ServiceImage`
// model (id, serviceId, url, order) if multiple ordered images with
// their own metadata are wanted. Either is a schema change requiring
// its own approval, not made here.

export function ServiceGallery() {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-accent/5 text-center sm:h-96">
      <ImageOff size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-sm text-foreground/50">لا تتوفر صور لهذه التجربة بعد</p>
    </div>
  );
}
