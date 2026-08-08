import "server-only";
import { prisma } from "@/lib/db";

// Resolve a service's media in ONE bounded query (Media Foundation, Gap C).
// A service has at most 1 cover + MAX_SERVICE_GALLERY_ITEMS gallery images,
// so this never fans out. Used by the provider edit surface (management).
// Public list/detail read paths fetch media via relational include on their
// existing queries (get-services / get-service-detail) — no extra round-trip,
// no N+1.

export type ServiceMediaItem = { id: string; url: string; kind: string };

export type ServiceMediaSet = {
  cover: ServiceMediaItem | null;
  gallery: ServiceMediaItem[];
};

export async function getServiceMedia(serviceId: string): Promise<ServiceMediaSet> {
  const assets = await prisma.mediaAsset.findMany({
    where: { serviceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, kind: true },
  });

  return {
    cover: assets.find((a) => a.kind === "COVER") ?? null,
    gallery: assets.filter((a) => a.kind === "GALLERY"),
  };
}
