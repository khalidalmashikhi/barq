import "server-only";
import { prisma } from "@/lib/db";

// Resolve a provider's media in ONE bounded query (Media Foundation, Gap C).
// A provider has at most 1 logo + 1 cover + MAX_PROVIDER_PORTFOLIO_ITEMS
// portfolio images, so this never fans out — no N+1, safe for a detail page.
// Used by both Settings (management) and the public profile (display).

export type ProviderMediaItem = { id: string; url: string; kind: string };

export type ProviderMediaSet = {
  logo: ProviderMediaItem | null;
  cover: ProviderMediaItem | null;
  portfolio: ProviderMediaItem[];
};

export async function getProviderMedia(providerId: string): Promise<ProviderMediaSet> {
  const assets = await prisma.mediaAsset.findMany({
    where: { providerId },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, kind: true },
  });

  return {
    logo: assets.find((a) => a.kind === "LOGO") ?? null,
    cover: assets.find((a) => a.kind === "COVER") ?? null,
    portfolio: assets.filter((a) => a.kind === "PORTFOLIO"),
  };
}
