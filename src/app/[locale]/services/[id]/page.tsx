import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import {
  getServiceById,
  getRelatedServices,
  getProviderPublishedServicesCount,
  getReviewsForService,
  getServiceRatingAggregate,
} from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { ServiceGallery } from "@/components/services/service-gallery";
import { ProviderProfileCard } from "@/components/services/provider-profile-card";
import { ReviewsSection } from "@/components/services/reviews-section";
import { MeetingPointMap } from "@/components/services/meeting-point-map";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { BookingTrustPanel } from "@/components/services/booking-trust-panel";
import { SafetyInfo } from "@/components/services/safety-info";
import { Calendar, Clock, MapPin, BadgeCheck, Share2 } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { buildBreadcrumbListJsonLd, buildServiceProductJsonLd } from "@/lib/seo/structured-data";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import { ShareButton } from "@/components/ui/share-button";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { FadeIn } from "@/components/ui/fade-in";
import { Badge } from "@/components/ui/badge";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const service = await getServiceById(id);
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const locale = await getLocale();

  if (!service) {
    // Phase B Group 5 — SEO/hreflang: a nonexistent service gets no
    // canonical and no hreflang alternates (there is nothing for those
    // to correctly point to). No explicit `robots` field either —
    // Next.js already emits its own `noindex` meta tag automatically
    // whenever a route calls notFound() (verified empirically: adding
    // one here produced two separate <meta name="robots"> tags, not
    // one merged value).
    return {
      title: tSeo("pageTitleTemplate", { page: tSeo("serviceNotFoundTitle"), appName: tCommon("appName") }),
    };
  }

  return buildLocalizedMetadata({
    locale,
    pathname: `/services/${id}`,
    title: tSeo("pageTitleTemplate", { page: service.name, appName: tCommon("appName") }),
    description: service.description || tSeo("serviceDescriptionFallback", {
      serviceName: service.name, providerName: service.providerName, appName: tCommon("appName"),
    }),
    // Growth Foundations phase — points Open Graph/Twitter at this
    // page's own dynamic opengraph-image.tsx route instead of the
    // shared static logo every other page still uses.
    images: [buildPublicUrl(locale, `/services/${id}/opengraph-image`)],
  });
}

export default async function ServiceDetailPage({ params }: Props) {
  const { id } = await params;
  const fetchedService = await getServiceById(id);
  if (!fetchedService) { notFound(); return null; }
  const service = fetchedService;

  const [relatedServices, slots, providerPublishedServicesCount, reviews, ratingAggregate] = await Promise.all([
    getRelatedServices(service.id, service.providerId),
    getAvailableSlots(service.id),
    getProviderPublishedServicesCount(service.providerId),
    getReviewsForService(service.id),
    getServiceRatingAggregate(service.id),
  ]);

  const t = await getServerTranslator("services");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  // Growth Foundations phase — structured data built only from real,
  // already-fetched fields. `service.price` is the combined
  // "{amount} {currency}" string get-service-detail.ts already builds;
  // splitting it back into its two parts here is cheaper and safer than
  // adding a second, parallel raw-amount/currency field to that query's
  // return shape for this one consumer.
  const serviceUrl = buildPublicUrl(locale, `/services/${service.id}`);
  const [priceAmount, priceCurrency] = service.price?.split(" ") ?? [];
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: t("title"), url: buildPublicUrl(locale, "/services") },
    { name: service.name, url: serviceUrl },
  ]);
  const productJsonLd = buildServiceProductJsonLd({
    name: service.name,
    description: service.description || undefined,
    url: serviceUrl,
    priceAmount,
    priceCurrency,
    ratingValue: ratingAggregate.averageRating ?? undefined,
    ratingCount: ratingAggregate.reviewCount,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(productJsonLd) }} />
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <FadeIn>
          <ServiceGallery />
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

            <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
                  <Clock size={18} strokeWidth={1.75} />
                </span>
                <div className="flex flex-col">
                  <span className="text-xs text-foreground/50">{t("durationLabel")}</span>
                  <span className="text-sm font-medium text-foreground">{t("notSpecifiedLabel")}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
                  <MapPin size={18} strokeWidth={1.75} />
                </span>
                <div className="flex flex-col">
                  <span className="text-xs text-foreground/50">{t("meetingPointLabel")}</span>
                  <span className="text-sm font-medium text-foreground">{t("notSpecifiedLabel")}</span>
                </div>
              </div>
            </div>

            {slots.length > 0 && (
              <div>
                <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Calendar size={18} strokeWidth={1.75} />
                  {tBooking("upcomingSlotsTitle")}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {slots.map((slot) => {
                    const date = new Date(slot.startTime);
                    const isToday = date.toDateString() === new Date().toDateString();
                    return (
                      <div key={slot.id} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
                        <span className="text-sm font-medium text-foreground">
                          {isToday ? t("todayLabel") : formatDate(date, locale, { weekday: "long", day: "numeric", month: "long" })}
                        </span>
                        <span className="text-sm text-foreground/60">{formatDate(date, locale, { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="text-xs text-primary">{slot.remainingSeats} {tBooking("remainingSeatsLabel")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div id="meeting-point" className="scroll-mt-32">
              <MeetingPointMap />
            </div>

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
                    <ExperienceCard key={related.id} serviceId={related.id} title={related.name} providerName={related.providerName} price={related.price} imageAspect="premium" />
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
                <p className="text-xs text-foreground/50">{tBooking("priceLabel")}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-primary">{service.price ?? t("priceUnavailableLabel")}</p>
                {slots.length > 0 && (
                  <p className="mt-2 text-xs text-foreground/50">{t("slotsAvailableLabel", { count: slots.length })}</p>
                )}
                <Link
                  href={`/services/${service.id}/book`}
                  className="mt-4 block w-full rounded-full bg-primary px-6 py-2.5 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {t("bookNowButton")}
                </Link>
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
              </div>

              <BookingTrustPanel />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
