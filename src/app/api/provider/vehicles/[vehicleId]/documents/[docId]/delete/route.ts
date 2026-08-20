import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { deleteVehicleDocument } from "@/lib/vehicles/documents/delete-vehicle-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// VEHICLE-LC2 — delete one of the caller's own PENDING/REJECTED vehicle documents.
// Ownership + policy enforced by the domain action (docId → Asset → Provider).

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

export async function POST(request: Request, ctx: { params: Promise<{ vehicleId: string; docId: string }> }) {
  return withRequestTracing("provider.vehicles.documents.delete", async () => {
    const { vehicleId, docId } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/vehicles/${vehicleId}${q}`, request.url);
    try {
      const result = await deleteVehicleDocument(vehicleId, docId);
      return NextResponse.redirect(dest(result.ok ? "?docNotice=deleted" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
