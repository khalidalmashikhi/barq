import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Edit, Eye, Compass, ClipboardList } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderDetail } from "@/lib/admin/get-provider-detail";
import { approveProvider } from "@/lib/admin/approve-provider";
import { archiveProvider } from "@/lib/admin/archive-provider";
import { publishProvider, unpublishProvider } from "@/lib/admin/toggle-provider-visibility";
import { getProviderStatusBadgeVariant, getProviderStatusTranslationKey } from "@/lib/admin/presentation/provider-status";
import { isProviderAdminActionErrorCode, getProviderAdminErrorTranslationKey } from "@/lib/admin/provider-admin-errors";
import { getAuditEventsForEntity, type AuditEventItem } from "@/lib/admin/get-audit-events-for-entity";
import { AuditHistory } from "@/components/admin/audit-history";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Provider detail — Phase 2.2 (Provider Admin UI). Mirrors
// admin/categories/[id]/page.tsx's shape: status/visibility control
// lives here (needs more room than a list row), the list row keeps
// single-click quick actions. No nested child entity here (unlike
// Category's SubCategory), so this page is a straightforward detail +
// action panel, not a parent/children layout.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function ProviderDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let provider;
  try {
    provider = await getProviderDetail(id);
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

  if (!provider) {
    notFound();
  }

  const errorMessage = error && isProviderAdminActionErrorCode(error) ? t(getProviderAdminErrorTranslationKey(error)) : null;
  const isPending = provider.status === "APPLIED" || provider.status === "UNDER_REVIEW";

  let auditEvents: AuditEventItem[] = [];
  try {
    auditEvents = await getAuditEventsForEntity("Provider", id);
  } catch {
    auditEvents = [];
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/providers" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToProvidersLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{provider.businessName.en}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">{provider.slug ? `/${provider.slug}` : t("noSlugLabel")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getProviderStatusBadgeVariant(provider.status)}>{t(getProviderStatusTranslationKey(provider.status))}</Badge>
          <Badge variant={provider.visible ? "success" : "default"}>
            {provider.visible ? t("providerVisibleLabel") : t("providerHiddenLabel")}
          </Badge>
          {/* See the provider's customer-facing storefront before approving —
              Unified Preview System. New tab. */}
          <Link
            href={`/admin/providers/${id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Eye size={14} strokeWidth={1.75} />
            {t("previewProfileButton")}
          </Link>
          <Link
            href={`/admin/providers/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Edit size={14} strokeWidth={1.75} />
            {t("editProviderButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("providerDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("providerNameArLabel")}</dt>
            <dd className="text-sm text-foreground" dir="rtl">{provider.businessName.ar}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerNameEnLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.businessName.en}</dd>
          </div>
          {provider.businessDescription && (
            <>
              <div>
                <dt className="text-xs text-foreground/40">{t("providerDescriptionArLabel")}</dt>
                <dd className="text-sm text-foreground" dir="rtl">{provider.businessDescription.ar || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground/40">{t("providerDescriptionEnLabel")}</dt>
                <dd className="text-sm text-foreground">{provider.businessDescription.en || "—"}</dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("providerTypeLabel")}</dt>
            <dd className="text-sm text-foreground">
              {provider.providerType === "INDIVIDUAL" ? t("providerTypeIndividual") : t("providerTypeCompany")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerContactEmailLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.contactEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerCityLabel")}</dt>
            <dd className="text-sm text-foreground">{provider.city || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("providerLogoUrlLabel")}</dt>
            <dd className="truncate text-sm text-foreground">{provider.logoUrl || "—"}</dd>
          </div>
          {provider.approvedAt && (
            <div>
              <dt className="text-xs text-foreground/40">{t("providerApprovedAtLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(provider.approvedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("providerCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(provider.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("providerActionsTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {isPending && (
            <form
              action={async () => {
                "use server";
                const result = await approveProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {t("approveButton")}
              </SubmitButton>
            </form>
          )}

          <form
            action={async () => {
              "use server";
              const result = provider.visible ? await unpublishProvider(id) : await publishProvider(id);
              if (!result.ok) {
                redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                return;
              }
              redirect({ href: `/admin/providers/${id}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
              {provider.visible ? t("unpublishProviderButton") : t("publishProviderButton")}
            </SubmitButton>
          </form>

          {provider.status !== "DEACTIVATED" && (
            <form
              action={async () => {
                "use server";
                const result = await archiveProvider(id);
                if (!result.ok) {
                  redirect({ href: `/admin/providers/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/providers/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("archiveProviderButton")}
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("relatedTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/admin/services?providerId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Compass size={14} strokeWidth={1.75} />
            {t("viewProviderServicesLabel")}
          </Link>
          <Link
            href={`/admin/bookings?providerId=${id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <ClipboardList size={14} strokeWidth={1.75} />
            {t("viewProviderBookingsLabel")}
          </Link>
        </div>
      </Card>

      <AuditHistory events={auditEvents} title={t("um_auditHistoryTitle")} emptyLabel={t("um_auditNoEvents")} actorLabel={t("um_auditActorLabel")} locale={locale} />
    </div>
  );
}
