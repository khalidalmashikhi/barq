import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getStaffDetail } from "@/lib/admin/get-staff-detail";
import { getAuditEventsForEntity, type AuditEventItem } from "@/lib/admin/get-audit-events-for-entity";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuditHistory } from "@/components/admin/audit-history";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  let staff: Awaited<ReturnType<typeof getStaffDetail>> = null;
  let events: AuditEventItem[] = [];
  try {
    staff = await getStaffDetail(id);
    if (staff) events = await getAuditEventsForEntity("Staff", id);
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
  if (!staff) notFound();

  const dateFmt = (d: Date) => formatDate(d, locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/users?tab=staff" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("um_backToUsers")}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 dir="ltr" className="text-start text-2xl font-semibold text-foreground">{staff.phoneNumber}</h1>
        <Badge variant={staff.status === "ACTIVE" ? "success" : "danger"}>
          {staff.status === "ACTIVE" ? t("um_status_ACTIVE") : t("um_status_DEACTIVATED")}
        </Badge>
      </div>

      <Card hoverLift={false}>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-foreground/40">{t("um_detail_userId")}</dt>
            <dd dir="ltr" className="break-all text-start text-sm text-foreground">{staff.userId}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("um_detail_created")}</dt>
            <dd className="text-sm text-foreground">{dateFmt(staff.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("um_detail_lastLogin")}</dt>
            <dd className="text-sm text-foreground">{staff.lastLoginAt ? dateFmt(staff.lastLoginAt) : t("um_lastLoginNever")}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("um_detail_roles")}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {staff.roles.length === 0 ? (
                <span className="text-sm text-foreground/40">{t("um_noRoles")}</span>
              ) : (
                staff.roles.map((role) => <Badge key={role} variant="default">{t(`um_role_${role}`)}</Badge>)
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <AuditHistory events={events} title={t("um_auditHistoryTitle")} emptyLabel={t("um_auditNoEvents")} actorLabel={t("um_auditActorLabel")} locale={locale} />
    </div>
  );
}
