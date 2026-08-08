import { NextResponse } from "next/server";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { updateServiceCover } from "@/lib/service/media/update-service-cover";
import { addServiceGalleryImage } from "@/lib/service/media/add-service-gallery-image";
import { deleteServiceMedia } from "@/lib/service/media/delete-service-media";

// Service media endpoint (Media Foundation, Gap C). One authenticated route
// handler for cover/gallery/delete (discriminated by the `op` field), each a
// native multipart form POST from the service edit page — progressively
// enhanced, no client JS, and outside the 1 MB server-action body limit (see
// the provider media routes' notes). Ownership is enforced inside each
// orchestration against the authenticated provider; bytes flow browser →
// here → Supabase, the service-role key never reaching the browser.

const SUPPORTED_LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";

function resolveLocale(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? raw : DEFAULT_LOCALE;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: serviceId } = await params;
  return withRequestTracing("provider.service.media", async () => {
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const editUrl = (query: string) =>
      new URL(`/${locale}/provider/services/${serviceId}/edit${query}`, request.url);

    let providerId: string;
    try {
      providerId = (await requireProvider()).provider.id;
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.redirect(editUrl("?mediaError=NO_PROVIDER_PROFILE"), 303);
      }
      throw error;
    }

    const op = formData.get("op");

    if (op === "cover") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.redirect(editUrl("?mediaError=EMPTY_FILE"), 303);
      }
      const result = await updateServiceCover(file, serviceId, providerId);
      return NextResponse.redirect(editUrl(result.ok ? "?coverSaved=1" : `?mediaError=${result.error}`), 303);
    }

    if (op === "gallery") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.redirect(editUrl("?mediaError=EMPTY_FILE"), 303);
      }
      const result = await addServiceGalleryImage(file, serviceId, providerId);
      return NextResponse.redirect(editUrl(result.ok ? "?gallerySaved=1" : `?mediaError=${result.error}`), 303);
    }

    if (op === "delete") {
      const mediaId = formData.get("mediaId");
      if (typeof mediaId !== "string" || !mediaId) {
        return NextResponse.redirect(editUrl("?mediaError=INVALID_INPUT"), 303);
      }
      const result = await deleteServiceMedia(mediaId, serviceId, providerId);
      return NextResponse.redirect(editUrl(result.ok ? "?mediaDeleted=1" : `?mediaError=${result.error}`), 303);
    }

    return NextResponse.redirect(editUrl("?mediaError=INVALID_INPUT"), 303);
  });
}
