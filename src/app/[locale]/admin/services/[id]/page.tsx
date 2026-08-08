import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Edit, Eye, Users, ClipboardList, Tag, CalendarClock } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getServiceDetail } from "@/lib/admin/get-service-detail";
import { publishService, unpublishService, archiveService } from "@/lib/admin/transition-service-status";
import { getServiceStatusBadgeVariant, getServiceStatusTranslationKey } from "@/lib/services/presentation/service-status";
import { isServiceAdminActionErrorCode, getServiceAdminErrorTranslationKey } from "@/lib/admin/service-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Service detail — Phase 2.4 (Service Admin UI). Mirrors
// admin/providers/[id]/page.tsx's shape: status control lives here
// (needs more room than a list row), the list row keeps single-click
// quick actions. No nested child entity here, so this is a
// straightforward detail + action panel.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function ServiceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let service;
  try {
    service = await getServiceDetail(id);
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

  const errorMessage = error && isServiceAdminActionErrorCode(error) ? t(getServiceAdminErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/services" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{service.name.en}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">{service.providerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getServiceStatusBadgeVariant(service.status)}>{t(getServiceStatusTranslationKey(service.status))}</Badge>
          <Link
            href={`/admin/services/${id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Eye size={14} strokeWidth={1.75} />
            {t("previewServiceButton")}
          </Link>
          <Link
            href={`/admin/services/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Edit size={14} strokeWidth={1.75} />
            {t("editServiceButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("serviceDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("serviceNameArLabel")}</dt>
            <dd className="text-sm text-foreground" dir="rtl">{service.name.ar}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("serviceNameEnLabel")}</dt>
            <dd className="text-sm text-foreground">{service.name.en}</dd>
          </div>
          {service.description && (
            <>
              <div>
                <dt className="text-xs text-foreground/40">{t("serviceDescriptionArLabel")}</dt>
                <dd className="text-sm text-foreground" dir="rtl">{service.description.ar || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground/40">{t("serviceDescriptionEnLabel")}</dt>
                <dd className="text-sm text-foreground">{service.description.en || "—"}</dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("serviceProviderLabel")}</dt>
            <dd className="text-sm text-foreground">{service.providerName}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("serviceActivePriceLabel")}</dt>
            <dd className="text-sm text-foreground">
              {service.activePrice ? `${service.activePrice.amount} ${service.activePrice.currency}` : t("noActivePriceLabel")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("serviceCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(service.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("serviceActionsTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {service.status !== "ARCHIVED" && (
            <form
              action={async () => {
                "use server";
                const result = service.status === "PUBLISHED" ? await unpublishService(id) : await publishService(id);
                if (!result.ok) {
                  redirect({ href: `/admin/services/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/services/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                {service.status === "PUBLISHED" ? t("unpublishServiceButton") : t("publishServiceButton")}
              </SubmitButton>
            </form>
          )}

          {service.status !== "ARCHIVED" && (
            <form
              action={async () => {
                "use server";
                const result = await archiveService(id);
                if (!result.ok) {
                  redirect({ href: `/admin/services/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/services/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("archiveServiceButton")}
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("relatedTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/admin/providers/${service.providerId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Users size={14} strokeWidth={1.75} />
            {t("viewServiceProviderLabel")}
          </Link>
          <Link
            href={`/admin/bookings?serviceId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <ClipboardList size={14} strokeWidth={1.75} />
            {t("viewServiceBookingsLabel")}
          </Link>
          <Link
            href={`/admin/prices?serviceId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Tag size={14} strokeWidth={1.75} />
            {t("viewServicePricesLabel")}
          </Link>
          <Link
            href={`/admin/availability?serviceId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <CalendarClock size={14} strokeWidth={1.75} />
            {t("viewServiceAvailabilityLabel")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
