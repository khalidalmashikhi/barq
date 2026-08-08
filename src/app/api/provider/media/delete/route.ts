import { withProviderMediaRoute } from "@/lib/provider/media/media-route-helpers";
import { deleteProviderMedia } from "@/lib/provider/media/delete-provider-media";

// Delete one provider media item — logo, cover, or portfolio image (Media
// Foundation, Gap C). Ownership is enforced in deleteProviderMedia().

export async function POST(request: Request) {
  return withProviderMediaRoute(request, "provider.media.delete", async ({ formData, providerId }) => {
    const mediaId = formData.get("mediaId");
    if (typeof mediaId !== "string" || !mediaId) {
      return "?mediaError=INVALID_INPUT";
    }
    const result = await deleteProviderMedia(mediaId, providerId);
    return result.ok ? "?mediaDeleted=1" : `?mediaError=${result.error}`;
  });
}
