import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getServiceById, getRelatedServices } from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { ServiceGallery } from "@/components/services/service-gallery";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { Calendar } from "lucide-react";
import { t } from "@/lib/i18n/strings";

type Props = {
  params: Promise<{ id: string }>;
};

// generateMetadata uses REAL Service name/description for SEO — not
// invented copy. Falls back to generic BARQ metadata only if the
// service genuinely doesn't exist (404 case).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const service = await getServiceById(id);

  if (!service) {
    return { title: "التجربة غير موجودة | برق" };
  }

  return {
    title: `${service.name} | برق`,
    description: service.description || `احجز ${service.name} من ${service.providerName} عبر برق`,
  };
}

export default async function ServiceDetailPage({ params }: Props) {
  const { id } = await params;
  const fetchedService = await getServiceById(id);

  if (!fetchedService) {
    notFound();
    return null;
  }

  const service = fetchedService;

  const [relatedServices, slots] = await Promise.all([
    getRelatedServices(service.id, service.providerId),
    getAvailableSlots(service.id),
  ]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <ServiceGallery />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{service.name}</h1>
          <p className="mt-1 text-sm text-foreground/50">{service.providerName}</p>
          {service.description && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-foreground/70">{service.description}</p>
          )}
        </div>

        <div className="shrink-0 rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
          <p className="text-xs text-foreground/50">السعر</p>
          <p className="mt-1 text-xl font-semibold text-primary">{service.price ?? "غير متوفر"}</p>
          <Link
            href={`/services/${service.id}/book`}
            className="mt-4 block w-full rounded-full bg-primary px-6 py-2.5 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            احجز الآن
          </Link>
        </div>
      </div>

      {slots.length > 0 && (
        <div>
          <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
            <Calendar size={18} strokeWidth={1.75} />
            {t.upcomingSlotsTitle}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slots.map((slot) => {
              const date = new Date(slot.startTime);
              const isToday = date.toDateString() === new Date().toDateString();
              return (
                <div key={slot.id} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
                  <span className="text-sm font-medium text-foreground">
                    {isToday
                      ? "اليوم"
                      : date.toLocaleDateString("ar-OM", { weekday: "long", day: "numeric", month: "long" })}
                  </span>
                  <span className="text-sm text-foreground/60">
                    {date.toLocaleTimeString("ar-OM", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-xs text-primary">
                    {slot.remainingSeats} {t.remainingSeatsLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {service.providerDescription && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium text-foreground/70">عن المزود</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/70">{service.providerDescription}</p>
        </div>
      )}

      {relatedServices.length > 0 && (
        <div>
          <h2 className="mb-5 text-lg font-semibold text-foreground">تجارب أخرى من نفس المزود</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {relatedServices.map((related) => (
              <Link key={related.id} href={`/services/${related.id}`}>
                <ExperienceCard serviceId={related.id} title={related.name} providerName={related.providerName} price={related.price} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
