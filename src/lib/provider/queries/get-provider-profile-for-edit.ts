import "server-only";
import { requireProvider } from "@/lib/auth";

// Provider Settings (edit form) query — Provider Operations Foundation.
//
// Reads the raw bilingual Json fields directly (both "ar" and "en"),
// same reasoning as getProviderServiceForEdit()'s own note: an edit
// form must show both language values, not just whichever one
// extractText() happens to surface.
//
// No separate Prisma call needed: requireProvider() already resolves
// and returns the exact, authenticated provider's own row — there is
// no "other provider's profile" to accidentally read, unlike
// getProviderServiceForEdit()'s findFirst-by-id-and-owner pattern.

export type ProviderProfileForEdit = {
  businessNameAr: string;
  businessNameEn: string;
  businessDescriptionAr: string;
  businessDescriptionEn: string;
  contactEmail: string;
  city: string;
  logoUrl: string;
  providerType: string;
};

function readBilingual(value: unknown): { ar: string; en: string } {
  if (value && typeof value === "object") {
    const obj = value as { ar?: unknown; en?: unknown };
    return {
      ar: typeof obj.ar === "string" ? obj.ar : "",
      en: typeof obj.en === "string" ? obj.en : "",
    };
  }
  return { ar: "", en: "" };
}

export async function getProviderProfileForEdit(): Promise<ProviderProfileForEdit> {
  const { provider } = await requireProvider();

  const name = readBilingual(provider.businessName);
  const description = readBilingual(provider.businessDescription);

  return {
    businessNameAr: name.ar,
    businessNameEn: name.en,
    businessDescriptionAr: description.ar,
    businessDescriptionEn: description.en,
    contactEmail: provider.contactEmail ?? "",
    city: provider.city ?? "",
    logoUrl: provider.logoUrl ?? "",
    providerType: provider.providerType,
  };
}
