import { withProviderMediaRoute } from "@/lib/provider/media/media-route-helpers";
import { addProviderPortfolioImage } from "@/lib/provider/media/add-provider-portfolio-image";

// Add one provider portfolio/gallery image (Media Foundation, Gap C).

export async function POST(request: Request) {
  return withProviderMediaRoute(request, "provider.media.portfolio", async ({ formData, providerId }) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return "?mediaError=EMPTY_FILE";
    }
    const result = await addProviderPortfolioImage(file, providerId);
    return result.ok ? "?portfolioSaved=1" : `?mediaError=${result.error}`;
  });
}
