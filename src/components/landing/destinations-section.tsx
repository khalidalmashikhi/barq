import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { DestinationImage } from "@/components/dashboard/destination-image";
import { DESTINATION_IMAGES } from "@/components/dashboard/destination-images";
import type { BrandPatternTone } from "@/components/ui/brand-pattern";

// Popular Destinations — Phase F.1, landing page section 5. Same
// honest caveat as Categories: no location field exists on
// Service/Provider yet (get-services.ts's own documented gap), so
// these link to /services generally rather than a fake per-destination
// filter. Reuses DestinationImage (Visual Identity Redesign) — a
// BrandPattern-backed fallback (not a fake gradient photo) when the
// real photo file doesn't exist yet at its listed path, same as every
// other card in this app already does.
//
// `tone` is a fixed, hand-assigned rotation (not derived from a hash)
// so the 6-card grid visibly alternates rather than clustering by
// coincidence — deliberately not randomized, to avoid any server/client
// hydration mismatch.

const destinations = [
  { key: "muscat", image: DESTINATION_IMAGES.muscat, tone: "navy" },
  { key: "salalah", image: DESTINATION_IMAGES.salalah, tone: "teal" },
  { key: "nizwa", image: DESTINATION_IMAGES.nizwa, tone: "sand" },
  { key: "wahibaSands", image: DESTINATION_IMAGES.sharqiyaSands, tone: "navy" },
  { key: "jebelAkhdar", image: DESTINATION_IMAGES.jebelAkhdar, tone: "teal" },
  { key: "musandam", image: DESTINATION_IMAGES.musandam, tone: "sand" },
] as const satisfies ReadonlyArray<{ key: string; image: string; tone: BrandPatternTone }>;

export async function DestinationsSection() {
  const t = await getServerTranslator("landing");
  const [featured, ...rest] = destinations;

  return (
    <section id="destinations" className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-10 flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("destinations.title")}</h2>
        <p className="max-w-xl text-foreground/60">{t("destinations.subtitle")}</p>
      </div>

      <Link
        href="/services"
        className="group relative mb-5 block h-64 overflow-hidden rounded-3xl shadow-premium transition-shadow duration-300 hover:shadow-premium-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:h-80"
      >
        <DestinationImage
          src={featured.image}
          alt={t(`destinations.${featured.key}`)}
          tone={featured.tone}
          className="h-full w-full transition-transform duration-500 group-hover:scale-105"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-primary/75 via-primary/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-6">
          <span className="text-xs font-medium uppercase tracking-wide text-white/70">{t("destinations.featuredLabel")}</span>
          <span className="text-2xl font-bold text-white sm:text-3xl">{t(`destinations.${featured.key}`)}</span>
        </div>
      </Link>

      <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 sm:mx-0 sm:px-0">
        {rest.map(({ key, image, tone }) => (
          <Link
            key={key}
            href="/services"
            className="group relative block h-40 w-56 shrink-0 snap-start overflow-hidden rounded-2xl shadow-sm transition-shadow duration-300 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <DestinationImage
              src={image}
              alt={t(`destinations.${key}`)}
              tone={tone}
              className="h-full w-full transition-transform duration-500 group-hover:scale-105"
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-primary/70 via-primary/10 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 p-4 text-sm font-semibold text-white">
              {t(`destinations.${key}`)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
