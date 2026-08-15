import { getProviderProfileForEdit } from "@/lib/provider/queries/get-provider-profile-for-edit";
import { updateProviderProfile } from "@/lib/provider/update-provider-profile";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { providerProfileErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, buildFormData, coerceField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderProfileDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/profile — Gate PB.
//
// Thin adapter over getProviderProfileForEdit(), which resolves the caller's own
// provider via requireProvider() (no provider → NO_PROVIDER_PROFILE via the
// wrapper). Returns the provider's own editable fields (bilingual name/description
// + contactEmail self-view). No internal/admin/auth fields. Private/no-store.
//
// PATCH /api/v1/me/provider/profile — Gate PC (Provider Mutation API).
//
// Thin adapter over updateProviderProfile(), which resolves the caller's own
// provider from the session (requireProvider — an APPLIED provider may edit basic
// info) and validates every field itself. Exposes only the provider's own editable
// business fields; logoUrl stays owned by the dedicated media endpoint (Gap C), and
// slug/status/visibility stay admin-only — this route never sends them. On success
// it re-reads the canonical profile and returns the same DTO shape as GET.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.profile", () =>
    withApiV1Provider(request, async () => {
      const profile = await getProviderProfileForEdit();
      return apiOk(toProviderProfileDTO(profile));
    })
  );
}

export async function PATCH(request: Request) {
  return withRequestTracing("api.v1.me.provider.profile.update", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const body = await readJsonObject(request);
      const formData = buildFormData({
        businessNameAr: coerceField(body.businessNameAr),
        businessNameEn: coerceField(body.businessNameEn),
        businessDescriptionAr: coerceField(body.businessDescriptionAr),
        businessDescriptionEn: coerceField(body.businessDescriptionEn),
        contactEmail: coerceField(body.contactEmail),
        city: coerceField(body.city),
        providerType: coerceField(body.providerType),
      });

      const result = await updateProviderProfile(formData);
      if (!result.ok) return providerProfileErrorResponse(result.error, locale);

      const profile = await getProviderProfileForEdit();
      return apiOk(toProviderProfileDTO(profile));
    })
  );
}
