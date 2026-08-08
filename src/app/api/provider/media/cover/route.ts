import { withProviderMediaRoute } from "@/lib/provider/media/media-route-helpers";
import { updateProviderCover } from "@/lib/provider/media/update-provider-cover";

// Provider cover upload (Media Foundation, Gap C). See media-route-helpers.ts
// and update-provider-logo/route.ts for why this is a route handler.

export async function POST(request: Request) {
  return withProviderMediaRoute(request, "provider.media.cover", async ({ formData, providerId }) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return "?mediaError=EMPTY_FILE";
    }
    const result = await updateProviderCover(file, providerId);
    return result.ok ? "?coverSaved=1" : `?mediaError=${result.error}`;
  });
}
