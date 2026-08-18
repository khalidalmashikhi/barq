import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Eye } from "lucide-react";
import { UnauthenticatedError, ForbiddenError, requireProvider } from "@/lib/auth";
import { getProviderServiceForEdit } from "@/lib/provider/queries/get-provider-service-for-edit";
import { updateService } from "@/lib/provider/update-service";
import { isServiceActionErrorCode, getServiceErrorTranslationKey } from "@/lib/provider/service-action-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getProviderAuthorizedServiceCategories } from "@/lib/provider/get-provider-authorized-service-categories";
import { TourAwareCategoryField } from "@/components/tour-template/tour-aware-category-field";
import { getSmartTourContext } from "@/lib/tour-template/form/get-smart-tour-context";
import { RegionField } from "@/components/regions/region-field";
import { PricingUnitField } from "@/components/pricing-units/pricing-unit-field";
import { getServiceMedia } from "@/lib/service/media/get-service-media";
import { isProviderMediaErrorCode, getProviderMediaErrorTranslationKey } from "@/lib/provider/media/provider-media-errors";

// Edit Experience — Phase 4.2 (Provider Experience), Priority 1. Same
// shape as the Create page, pre-filled with the real bilingual values
// via getProviderServiceForEdit() (not getProviderServiceDetail(),
// which discards "en" — see that query's own note).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    coverSaved?: string;
    gallerySaved?: string;
    mediaDeleted?: string;
    mediaError?: string;
  }>;
};

export default async function EditServicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, coverSaved, gallerySaved, mediaDeleted, mediaError } = await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let service;
  try {
    service = await getProviderServiceForEdit(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  if (!service) {
    notFound();
  }

  const errorMessage = error && isServiceActionErrorCode(error) ? t(getServiceErrorTranslationKey(error)) : null;
  const mediaErrorMessage = mediaError && isProviderMediaErrorCode(mediaError) ? t(getProviderMediaErrorTranslationKey(mediaError)) : null;

  // Gate B5: offer only categories this provider is AUTHORIZED for (SELF/ADMIN/
  // LEGACY) ∩ assignable. HISTORICAL COMPATIBILITY: if this service sits on a
  // category the provider is no longer authorized for, that category won't appear
  // in the picker — but the current categoryId is still passed as the field's
  // defaultValue and round-trips through the hidden input, and update-service.ts
  // only re-checks authorization when the category actually CHANGES, so a
  // metadata-only save is never blocked. This picker is a UX affordance, not the
  // security boundary.
  const { provider } = await requireProvider();
  const categoryTree = await getProviderAuthorizedServiceCategories(provider.id);

  // TOUR-2 — smart-tour context. Edit hydrates from the SANITIZED guidingContent
  // (never raw Json) only when this service is already the tourist-guide category;
  // malformed historical content surfaces a recovery banner, not a crash.
  const smartTour = await getSmartTourContext({
    providerId: provider.id,
    providerType: provider.providerType,
    locale,
    serviceId: service.id,
    serviceCategoryId: service.categoryId,
  });

  // Service media (Gap C) — one bounded query for cover + gallery.
  const media = await getServiceMedia(id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href={`/provider/services/${id}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{t("editExperienceTitle")}</h1>
        {/* Preview the service as customers will see it (even while DRAFT),
            before publishing (Unified Preview System). Opens in a new tab. */}
        <Link
          href={`/provider/services/${id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
        >
          <Eye size={14} strokeWidth={1.75} />
          {t("previewServiceButton")}
        </Link>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateService(id, formData);
            if (!result.ok) {
              redirect({ href: `/provider/services/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/services/${id}`, locale });
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("nameArLabel")}</span>
              <input
                type="text"
                name="nameAr"
                required
                dir="rtl"
                defaultValue={service.nameAr}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("nameEnLabel")}</span>
              <input
                type="text"
                name="nameEn"
                required
                dir="ltr"
                defaultValue={service.nameEn}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("descriptionArLabel")}</span>
              <textarea
                name="descriptionAr"
                rows={3}
                dir="rtl"
                defaultValue={service.descriptionAr}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("descriptionEnLabel")}</span>
              <textarea
                name="descriptionEn"
                rows={3}
                dir="ltr"
                defaultValue={service.descriptionEn}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("categoryFieldLabel")}</span>
            <TourAwareCategoryField
              name="categoryId"
              tree={categoryTree}
              defaultValue={service.categoryId}
              labels={{ searchPlaceholder: t("categorySearchPlaceholder"), empty: t("categoryEmpty") }}
              hint={t("categoryFieldHint")}
              providerType={smartTour.providerType}
              touristGuideCategoryId={smartTour.touristGuideCategoryId}
              smartConfig={smartTour.smartConfig}
              guideProfile={smartTour.guideProfile}
              initialTourState={smartTour.initialTourState}
              tourMalformed={smartTour.tourMalformed}
            />
          </div>

          {/* Discovery/display metadata (Gate 4), prefilled from the current
              values. Governorate on its own row; the pricing unit updates the
              current active price's unit (display metadata only — the amount and
              booking behaviour are untouched). Empty = clear. */}
          <RegionField defaultValue={service.regionCode} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PricingUnitField defaultValue={service.pricingUnit} />
          </div>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("editSubmitButton")}
          </SubmitButton>
        </form>
      </Card>

      {coverSaved === "1" && <Alert variant="success">{t("serviceCoverSavedLabel")}</Alert>}
      {gallerySaved === "1" && <Alert variant="success">{t("serviceGallerySavedLabel")}</Alert>}
      {mediaDeleted === "1" && <Alert variant="success">{t("mediaDeletedLabel")}</Alert>}
      {mediaErrorMessage && <Alert variant="danger">{mediaErrorMessage}</Alert>}

      {/* Service media (Gap C) — cover + gallery. Native multipart POSTs to
          the authenticated route handler (op-discriminated); progressively
          enhanced, no client JS. */}
      <Card hoverLift={false}>
        <div className="flex flex-col gap-6">
          {/* Cover — singleton */}
          <div className="flex flex-col gap-3">
            <form action={`/api/provider/services/${id}/media`} method="post" encType="multipart/form-data" className="flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="op" value="cover" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("serviceCoverTitle")}</h2>
                <p className="mt-0.5 text-xs text-foreground/50">{t("serviceCoverHint")}</p>
              </div>
              {media.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- provider-supplied Supabase host; next/image remotePatterns is a POST-LAUNCH follow-up
                <img src={media.cover.url} alt="" className="h-40 w-full rounded-xl border border-border object-cover" />
              ) : (
                <div className="flex h-40 w-full items-center justify-center rounded-xl border border-dashed border-border text-xs text-foreground/40">
                  {t("noServiceCoverLabel")}
                </div>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("serviceCoverUploadButton")}</span>
                <input
                  type="file"
                  name="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  className="text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
                />
              </label>
              <button
                type="submit"
                className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("serviceCoverUploadButton")}
              </button>
            </form>
            {media.cover && (
              <form action={`/api/provider/services/${id}/media`} method="post">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="op" value="delete" />
                <input type="hidden" name="mediaId" value={media.cover.id} />
                <button type="submit" className="text-xs font-medium text-danger transition-opacity hover:opacity-80">
                  {t("mediaDeleteButton")}
                </button>
              </form>
            )}
          </div>

          <hr className="border-border" />

          {/* Gallery — multi-image */}
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("serviceGalleryTitle")}</h2>
              <p className="mt-0.5 text-xs text-foreground/50">{t("serviceGalleryHint")}</p>
            </div>
            {media.gallery.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {media.gallery.map((item) => (
                  <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element -- provider-supplied Supabase host; next/image remotePatterns is a POST-LAUNCH follow-up */}
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                    <form action={`/api/provider/services/${id}/media`} method="post" className="absolute end-1 top-1">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="op" value="delete" />
                      <input type="hidden" name="mediaId" value={item.id} />
                      <button
                        type="submit"
                        aria-label={t("mediaDeleteButton")}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm leading-none text-white transition-opacity hover:opacity-90"
                      >
                        ×
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground/40">{t("serviceGalleryEmptyLabel")}</p>
            )}
            <form action={`/api/provider/services/${id}/media`} method="post" encType="multipart/form-data" className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="op" value="gallery" />
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("serviceGalleryAddLabel")}</span>
                <input
                  type="file"
                  name="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  className="text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
                />
              </label>
              <button
                type="submit"
                className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("serviceGalleryAddButton")}
              </button>
            </form>
          </div>
        </div>
      </Card>
    </div>
  );
}
