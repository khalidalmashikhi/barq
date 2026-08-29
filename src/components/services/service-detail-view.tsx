import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { Calendar, Clock, MapPin, BadgeCheck, Share2, Users, Check, X, ClipboardList } from "lucide-react";
import type { ServiceDetail, RelatedService, ServiceRatingAggregate } from "@/lib/services/get-service-detail";
import { describeDuration } from "@/lib/services/duration";
import type { getAvailableSlots } from "@/lib/booking/get-available-slots";
import type { ReviewItem } from "@/components/services/reviews-section";
import { ServiceGallery } from "@/components/services/service-gallery";
import { ProviderProfileCard } from "@/components/services/provider-profile-card";
import { ReviewsSection } from "@/components/services/reviews-section";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { BookingTrustPanel } from "@/components/services/booking-trust-panel";
import { SafetyInfo } from "@/components/services/safety-info";
import { ShareButton } from "@/components/ui/share-button";
import { FadeIn } from "@/components/ui/fade-in";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";
import { isOmanToday } from "@/lib/date/oman-time";
import { regionLabelKey } from "@/lib/regions";
import { pricingUnitLabelKey } from "@/lib/pricing-units";
import type { PreviewMode } from "@/lib/preview/preview-mode";

// ServiceDetailView — Unified Preview System.
//
// The SINGLE customer-facing rendering of a service's detail body, extracted
// VERBATIM from the public services/[id] page so that page, the provider
// preview, and the admin preview all render the exact same presentation
// (no parallel implementation). Callers fetch the data and wrap this in their
// own <main>; the public page keeps its <main id="main-content"> + JSON-LD +
// Navbar/Footer, previews wrap it with a PreviewBanner.
//
// `mode` changes ONLY presentation: in a preview it swaps the active "Book
// now" link for a disabled placeholder (no booking path, no booking mutation,
// no customer flow). Everything else renders identically. It never relaxes any
// read gate or authorization — those are enforced by the caller/route.

type ServiceDetailViewProps = {
  service: ServiceDetail;
  relatedServices: RelatedService[];
  slots: Awaited<ReturnType<typeof getAvailableSlots>>;
  providerPublishedServicesCount: number;
  reviews: ReviewItem[];
  ratingAggregate: ServiceRatingAggregate;
  serviceUrl: string;
  mode: PreviewMode;
};

export async function ServiceDetailView({
  service,
  relatedServices,
  slots,
  providerPublishedServicesCount,
  reviews,
  serviceUrl,
  mode,
}: ServiceDetailViewProps) {
  const t = await getServerTranslator("services");
  const tBooking = await getServerTranslator("booking");
  const tCommon = await getServerTranslator("common");
  const locale = await getLocale();

  // Discovery/display metadata (Gate 4). Both fail safe: an unknown/absent code
  // yields no label, so the governorate tile is omitted and the price shows with
  // no unit rather than ever leaking a raw code. pricingUnit is display-only.
  const regionKey = regionLabelKey(service.regionCode);
  const unitKey = pricingUnitLabelKey(service.pricingUnit);

  // Service Information Model (Booking Decision Data) — all optional and localized upstream.
  const info = service.info;
  let durationText: string | null = null;
  if (info.durationMinutes !== null) {
    const d = describeDuration(info.durationMinutes);
    durationText = d.key === "durationHoursMinutes" ? t(d.key, { hours: d.hours, minutes: d.minutes }) : t(d.key, { count: d.count });
  }
  let bookingSize: string | null = null;
  if (info.minBookingSeats !== null && info.maxBookingSeats !== null) {
    bookingSize = t("bookingSizeRange", { min: info.minBookingSeats, max: info.maxBookingSeats });
  } else if (info.maxBookingSeats !== null) {
    bookingSize = t("bookingSizeUpTo", { max: info.maxBookingSeats });
  } else if (info.minBookingSeats !== null) {
    bookingSize = t("bookingSizeFrom", { min: info.minBookingSeats });
  }
  const priceDisplay =
    service.price && unitKey
      ? tCommon("priceWithUnit", { price: service.price, unit: tCommon(unitKey) })
      : service.price;

  return (
    <>
      <FadeIn>
        {/* Real service media (Gap C) — cover first, then gallery. Empty
            state renders only when the service genuinely has no media. */}
        <ServiceGallery
          images={[service.coverUrl, ...service.gallery].filter((url): url is string => Boolean(url))}
          alt={service.name}
        />
      </FadeIn>

      {/* Sticky in-page navigation — Phase 3 Wave 2. Plain anchor
          links (no client JS, no scroll-spy) to the page's own real
          sections below; orients visitors on what is otherwise a
          long single-scroll page. */}
      <nav className="sticky top-[74px] z-10 -mx-6 flex gap-6 overflow-x-auto border-b border-border bg-background/95 px-6 py-3 backdrop-blur-sm">
        <a href="#overview" className="shrink-0 text-sm font-medium text-foreground/60 transition-colors hover:text-primary">{t("overviewNavLabel")}</a>
        <a href="#meeting-point" className="shrink-0 text-sm font-medium text-foreground/60 transition-colors hover:text-primary">{t("meetingPointTitle")}</a>
        <a href="#safety" className="shrink-0 text-sm font-medium text-foreground/60 transition-colors hover:text-primary">{t("safetyTitle")}</a>
        <a href="#reviews" className="shrink-0 text-sm font-medium text-foreground/60 transition-colors hover:text-primary">{t("reviewsTitle")}</a>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-10 lg:col-span-2">
          <FadeIn delay={0.05}>
            <div id="overview" className="scroll-mt-32">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{service.name}</h1>
                {service.providerStatus === "APPROVED" && (
                  <Badge variant="info" className="gap-1">
                    <BadgeCheck size={13} strokeWidth={2} />
                    {t("verifiedProviderLabel")}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground/50">{service.providerName}</p>
              {service.description && (
                <p className="mt-4 text-sm leading-relaxed text-foreground/70">{service.description}</p>
              )}
            </div>
          </FadeIn>

          {/* Quick facts — every tile is optional and renders ONLY when the provider has
              authored it (Service Information Model). Legacy services with none omit the whole
              grid rather than showing "Not specified" placeholders. */}
          {(regionKey || info.durationMinutes !== null || bookingSize) && (
            <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
              {regionKey && (
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
                    <MapPin size={18} strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs text-foreground/60">{tCommon("governorate.fieldLabel")}</span>
                    <span className="text-sm font-medium text-foreground">{tCommon(regionKey)}</span>
                  </div>
                </div>
              )}
              {info.durationMinutes !== null && (
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
                    <Clock size={18} strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs text-foreground/60">{t("durationLabel")}</span>
                    <span className="text-sm font-medium text-foreground">{durationText}</span>
                  </div>
                </div>
              )}
              {bookingSize && (
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
                    <Users size={18} strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs text-foreground/60">{t("bookingSizeLabel")}</span>
                    <span className="text-sm font-medium text-foreground">{bookingSize}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {slots.length > 0 && (
            <div>
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
                <Calendar size={18} strokeWidth={1.75} />
                {tBooking("upcomingSlotsTitle")}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {slots.map((slot) => {
                  const date = new Date(slot.startTime);
                  // "Today" is decided by the Oman business calendar day, not the
                  // server/UTC day — a slot at 21:00Z is already tomorrow in Muscat.
                  const isToday = isOmanToday(date);
                  return (
                    <div key={slot.id} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
                      <span className="text-sm font-medium text-foreground">
                        {isToday ? t("todayLabel") : formatDate(date, locale, { weekday: "long", day: "numeric", month: "long" })}
                      </span>
                      <span className="text-sm text-foreground/60">{formatDate(date, locale, { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="text-sm font-medium text-primary">{slot.remainingSeats} {tBooking("remainingSeatsLabel")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* How it starts — real, provider-authored operational start instructions (meeting
              point / pickup / delivery / departure), shown only when present. Replaces the
              former static map placeholder. */}
          {info.startInstructions && (
            <div id="meeting-point" className="scroll-mt-32">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                <MapPin size={18} strokeWidth={1.75} />
                {t("startInstructionsTitle")}
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/70">{info.startInstructions}</p>
            </div>
          )}

          {info.inclusions.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                <Check size={18} strokeWidth={2} className="text-success" />
                {t("inclusionsTitle")}
              </h2>
              <ul className="flex flex-col gap-2">
                {info.inclusions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                    <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-success" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.exclusions.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                <X size={18} strokeWidth={2} className="text-foreground/40" />
                {t("exclusionsTitle")}
              </h2>
              <ul className="flex flex-col gap-2">
                {info.exclusions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                    <X size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-foreground/40" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.customerRequirements.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                <ClipboardList size={18} strokeWidth={1.75} />
                {t("requirementsTitle")}
              </h2>
              <ul className="flex flex-col gap-2">
                {info.customerRequirements.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div id="safety" className="scroll-mt-32">
            <SafetyInfo />
          </div>

          <ProviderProfileCard
            providerId={service.providerId}
            providerName={service.providerName}
            providerDescription={service.providerDescription}
            providerStatus={service.providerStatus}
            publishedServicesCount={providerPublishedServicesCount}
          />

          <div id="reviews" className="scroll-mt-32">
            <ReviewsSection reviews={reviews} />
          </div>

          {relatedServices.length > 0 && (
            <div>
              <h2 className="mb-5 text-lg font-semibold text-foreground">{t("moreFromProviderLabel")}</h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {relatedServices.map((related) => (
                  <ExperienceCard key={related.id} serviceId={related.id} title={related.name} providerName={related.providerName} price={related.price} coverImageUrl={related.coverUrl} imageAspect="premium" />
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-5 text-lg font-semibold text-foreground">{t("faqTitle")}</h2>
            <div className="flex flex-col gap-2">
              {(["faqBooking", "faqCancellation", "faqContact"] as const).map((key) => (
                <details key={key} className="group rounded-2xl border border-border bg-card p-4 open:pb-4">
                  <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:content-none">
                    {t(`${key}Question`)}
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/60">{t(`${key}Answer`)}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="flex flex-col gap-3 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-premium-lg">
              <p className="text-xs font-medium text-foreground/60">{tBooking("priceLabel")}</p>
              {/* Price with its display unit appended when present (Gate 4). Unit is
                  display metadata only — no total is computed from it. */}
              <p className="mt-1 text-3xl font-bold tracking-tight text-primary">{priceDisplay ?? t("priceUnavailableLabel")}</p>
              {slots.length > 0 && (
                <p className="mt-2 text-sm text-foreground/65">{t("slotsAvailableLabel", { count: slots.length })}</p>
              )}
              {mode === "public" ? (
                <Link
                  href={`/services/${service.id}/book`}
                  className="mt-4 block w-full rounded-full bg-primary px-6 py-2.5 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {t("bookNowButton")}
                </Link>
              ) : (
                // PREVIEW: no active booking path. A disabled placeholder keeps
                // the visual layout identical while exposing no booking flow or
                // mutation.
                <>
                  <span
                    aria-disabled="true"
                    className="mt-4 block w-full cursor-not-allowed rounded-full bg-primary/40 px-6 py-2.5 text-center text-sm font-medium text-primary-foreground/70"
                  >
                    {t("bookNowButton")}
                  </span>
                  <p className="mt-2 text-xs text-foreground/50">{t("previewBookingDisabledLabel")}</p>
                </>
              )}
              {/* Share is a PUBLIC-only action: the target /services/[id] URL is
                  not publicly openable while the service is unpublished, so
                  offering "share" in a provider/admin preview would share a dead
                  link. Matches ProviderProfileView, which already gates Share the
                  same way. */}
              {mode === "public" && (
                <div className="mt-3 flex justify-center">
                  <ShareButton
                    url={serviceUrl}
                    title={service.name}
                    text={t("shareExperienceText", { serviceName: service.name })}
                    label={t("shareLabel")}
                    copiedLabel={t("shareCopiedLabel")}
                    errorLabel={t("shareErrorLabel")}
                    icon={<Share2 size={14} strokeWidth={1.75} />}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                  />
                </div>
              )}
            </div>

            <BookingTrustPanel />
          </div>
        </div>
      </div>
    </>
  );
}
