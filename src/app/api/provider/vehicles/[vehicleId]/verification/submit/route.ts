import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { submitVehicleVerification } from "@/lib/vehicles/documents/submit-vehicle-verification";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// VEHICLE-LC2 — submit a vehicle for BARQ verification (DRAFT/CHANGES_REQUESTED →
// SUBMITTED). Thin: delegate to the self-authorizing submitVehicleVerification()
// (requireApprovedProvider + asset ownership + presence-only readiness + optimistic
// transition). It NEVER approves or activates. Progressive-<form> 303 back to the
// vehicle detail.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

export async function POST(request: Request, ctx: { params: Promise<{ vehicleId: string }> }) {
  return withRequestTracing("provider.vehicles.verification.submit", async () => {
    const { vehicleId } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/vehicles/${vehicleId}${q}`, request.url);
    try {
      const result = await submitVehicleVerification(vehicleId);
      return NextResponse.redirect(dest(result.ok ? "?verifyNotice=submitted" : `?verifyError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
