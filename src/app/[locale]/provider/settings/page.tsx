import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import { Eye } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderProfileForEdit } from "@/lib/provider/queries/get-provider-profile-for-edit";
import { updateProviderProfile } from "@/lib/provider/update-provider-profile";
import { isProviderProfileActionErrorCode, getProviderProfileErrorTranslationKey } from "@/lib/provider/provider-profile-errors";
import { isProviderLogoErrorCode, getProviderLogoErrorTranslationKey } from "@/lib/provider/media/provider-logo-errors";
import { isProviderMediaErrorCode, getProviderMediaErrorTranslationKey } from "@/lib/provider/media/provider-media-errors";
import { getProviderMedia } from "@/lib/provider/media/get-provider-media";
import { getMyProviderCategorySelection } from "@/lib/provider/get-my-provider-category-selection";
import { setProviderCategories } from "@/lib/provider/set-provider-categories";
import { ProviderCategoryChecklist } from "@/components/categories/provider-category-checklist";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Provider Settings — Provider Operations Foundation. Only exposes
// fields already present on the Provider model — no new schema fields,
// no new capability beyond letting a provider edit their own already-
// existing business info. See update-provider-profile.ts's own note on
// why this is a new, smaller, Provider-gated action rather than reusing
// admin/update-provider.ts.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    areasSaved?: string;
    areasError?: string;
    logoSaved?: string;
    logoError?: string;
    coverSaved?: string;
    portfolioSaved?: string;
    mediaDeleted?: string;
    mediaError?: string;
  }>;
};

export default async function ProviderSettingsPage({ searchParams }: Props) {
  const { error, saved, areasSaved, areasError, logoSaved, logoError, coverSaved, portfolioSaved, mediaDeleted, mediaError } =
    await searchParams;
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  let profile;
  try {
    profile = await getProviderProfileForEdit();
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

  const errorMessage = error && isProviderProfileActionErrorCode(error) ? t(getProviderProfileErrorTranslationKey(error)) : null;
  const logoErrorMessage = logoError && isProviderLogoErrorCode(logoError) ? t(getProviderLogoErrorTranslationKey(logoError)) : null;
  const mediaErrorMessage = mediaError && isProviderMediaErrorCode(mediaError) ? t(getProviderMediaErrorTranslationKey(mediaError)) : null;

  // Areas of activity (Gap G) — admin-managed taxonomy, editable any time.
  const { tree: categoryTree, selectedIds: selectedCategoryIds } = await getMyProviderCategorySelection();

  // Provider media (Gap C) — one bounded query for logo + cover + portfolio.
  const media = await getProviderMedia(profile.id);
  // INDIVIDUAL providers read as a person (portrait/avatar); COMPANY as a brand
  // (logo). Same upload flow/route — only the wording changes (reuses Gap D).
  const isIndividual = profile.providerType === "INDIVIDUAL";
  const logoTitle = isIndividual ? t("avatarSectionTitle") : t("logoSectionTitle");
  const logoHint = isIndividual ? t("avatarSectionHint") : t("logoSectionHint");
  const logoEmpty = isIndividual ? t("noAvatarLabel") : t("noLogoLabel");
  const logoButton = isIndividual ? t("avatarUploadButton") : t("logoUploadButton");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("settingsTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("settingsSubtitle")}</p>
        </div>
        {/* Preview the public storefront as customers will see it (works even
            before approval / while hidden) — Unified Preview System. New tab. */}
        <Link
          href="/provider/preview"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
        >
          <Eye size={14} strokeWidth={1.75} />
          {t("previewProfileButton")}
        </Link>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {saved === "1" && <Alert variant="success">{t("profileSavedLabel")}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateProviderProfile(formData);
            if (!result.ok) {
              redirect({ href: `/provider/settings?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/provider/settings?saved=1", locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5 sm:w-64">
            <span className="text-xs font-medium text-foreground/50">{t("providerTypeLabel")}</span>
            <select
              name="providerType"
              defaultValue={profile.providerType}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="INDIVIDUAL">{t("providerTypeIndividual")}</option>
              <option value="COMPANY">{t("providerTypeCompany")}</option>
            </select>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("publicNameArLabel")}</span>
              <input
                type="text"
                name="businessNameAr"
                required
                dir="rtl"
                defaultValue={profile.businessNameAr}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("publicNameEnLabel")}</span>
              <input
                type="text"
                name="businessNameEn"
                required
                dir="ltr"
                defaultValue={profile.businessNameEn}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("businessDescriptionArLabel")}</span>
              <textarea
                name="businessDescriptionAr"
                rows={3}
                dir="rtl"
                defaultValue={profile.businessDescriptionAr}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("businessDescriptionEnLabel")}</span>
              <textarea
                name="businessDescriptionEn"
                rows={3}
                dir="ltr"
                defaultValue={profile.businessDescriptionEn}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("contactEmailLabel")}</span>
              <input
                type="email"
                name="contactEmail"
                dir="ltr"
                defaultValue={profile.contactEmail}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("cityLabel")}</span>
              <input
                type="text"
                name="city"
                dir="ltr"
                defaultValue={profile.city}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("settingsSubmitButton")}
          </SubmitButton>
        </form>
      </Card>

      {logoSaved === "1" && <Alert variant="success">{t("logoSavedLabel")}</Alert>}
      {coverSaved === "1" && <Alert variant="success">{t("coverSavedLabel")}</Alert>}
      {portfolioSaved === "1" && <Alert variant="success">{t("portfolioSavedLabel")}</Alert>}
      {mediaDeleted === "1" && <Alert variant="success">{t("mediaDeletedLabel")}</Alert>}
      {logoErrorMessage && <Alert variant="danger">{logoErrorMessage}</Alert>}
      {mediaErrorMessage && <Alert variant="danger">{mediaErrorMessage}</Alert>}

      {/* Media (Gap C) — logo/avatar, cover, portfolio. Every upload/delete is
          a native multipart POST to an authenticated route handler: no client
          JS, progressively enhanced. See the routes' own notes on why. */}
      <Card hoverLift={false}>
        <div className="flex flex-col gap-6">
          {/* Logo / avatar — singleton. Wording follows ProviderType (Gap D). */}
          <div className="flex flex-col gap-3">
            <form action="/api/provider/media/logo" method="post" encType="multipart/form-data" className="flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">{logoTitle}</h2>
                <p className="mt-0.5 text-xs text-foreground/50">{logoHint}</p>
              </div>
              <div className="flex items-center gap-4">
                {profile.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- provider-supplied storage host; mirrors the public profile page
                  <img src={profile.logoUrl} alt="" className="h-16 w-16 rounded-full border border-border object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-border text-center text-[10px] leading-tight text-foreground/40">
                    {logoEmpty}
                  </div>
                )}
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground/50">{t("logoFileLabel")}</span>
                  <input
                    type="file"
                    name="file"
                    accept="image/png,image/jpeg,image/webp"
                    required
                    className="text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {logoButton}
              </button>
            </form>
            {media.logo && (
              <form action="/api/provider/media/delete" method="post">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="mediaId" value={media.logo.id} />
                <button type="submit" className="text-xs font-medium text-danger transition-opacity hover:opacity-80">
                  {t("mediaDeleteButton")}
                </button>
              </form>
            )}
          </div>

          <hr className="border-border" />

          {/* Cover — singleton, wide banner. */}
          <div className="flex flex-col gap-3">
            <form action="/api/provider/media/cover" method="post" encType="multipart/form-data" className="flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("coverSectionTitle")}</h2>
                <p className="mt-0.5 text-xs text-foreground/50">{t("coverSectionHint")}</p>
              </div>
              {media.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- provider-supplied storage host; mirrors the public profile page
                <img src={media.cover.url} alt="" className="h-32 w-full rounded-xl border border-border object-cover" />
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-border text-xs text-foreground/40">
                  {t("noCoverLabel")}
                </div>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("logoFileLabel")}</span>
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
                {t("coverUploadButton")}
              </button>
            </form>
            {media.cover && (
              <form action="/api/provider/media/delete" method="post">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="mediaId" value={media.cover.id} />
                <button type="submit" className="text-xs font-medium text-danger transition-opacity hover:opacity-80">
                  {t("mediaDeleteButton")}
                </button>
              </form>
            )}
          </div>

          <hr className="border-border" />

          {/* Portfolio — multi-image gallery (add / delete). */}
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("portfolioSectionTitle")}</h2>
              <p className="mt-0.5 text-xs text-foreground/50">{t("portfolioSectionHint")}</p>
            </div>
            {media.portfolio.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {media.portfolio.map((item) => (
                  <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element -- provider-supplied storage host; mirrors the public profile page */}
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                    <form action="/api/provider/media/delete" method="post" className="absolute end-1 top-1">
                      <input type="hidden" name="locale" value={locale} />
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
              <p className="text-xs text-foreground/40">{t("portfolioEmptyLabel")}</p>
            )}
            <form action="/api/provider/media/portfolio" method="post" encType="multipart/form-data" className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2">
              <input type="hidden" name="locale" value={locale} />
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("portfolioAddLabel")}</span>
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
                {t("portfolioAddButton")}
              </button>
            </form>
          </div>
        </div>
      </Card>

      {areasSaved === "1" && <Alert variant="success">{t("areasSavedLabel")}</Alert>}
      {areasError && <Alert variant="danger">{t("areasErrorLabel")}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await setProviderCategories(formData);
            redirect({
              href: result.ok ? "/provider/settings?areasSaved=1" : `/provider/settings?areasError=${result.error}`,
              locale,
            });
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("settingsAreasTitle")}</h2>
            <p className="mt-0.5 text-xs text-foreground/50">{t("settingsAreasHint")}</p>
          </div>

          <ProviderCategoryChecklist
            tree={categoryTree}
            selectedIds={selectedCategoryIds}
            emptyLabel={t("settingsAreasEmpty")}
          />

          <SubmitButton className="mt-1 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("settingsAreasSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
