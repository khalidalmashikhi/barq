import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, Car } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getVehicleReviewQueue, type VehicleReviewQueueItem } from "@/lib/vehicles/admin/get-vehicle-review-queue";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// VEHICLE-LC3 — Admin vehicle verification review QUEUE. Lists only SUBMITTED
// vehicles (getVehicleReviewQueue is requireAdmin()-gated and excludes DRAFT
// work-in-progress). Each row links to the review detail. Mirrors the providers
// list conventions (admin namespace, review-first).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminVehiclesPage() {
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  let queue: VehicleReviewQueueItem[];
  try {
    queue = await getVehicleReviewQueue();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Car size={22} strokeWidth={1.75} aria-hidden />
          {t("vehicleReviewQueueTitle")}
        </h1>
        <p className="mt-1 text-sm text-foreground/50">{t("vehicleReviewQueueSubtitle")}</p>
      </div>

      {queue.length === 0 ? (
        <Card hoverLift={false}>
          <p className="py-6 text-center text-sm text-foreground/50">{t("vehicleReviewQueueEmpty")}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.map((v) => {
            const title = buildVehicleTitle(v.make, v.model) ?? t("vehicleUntitledLabel");
            const complete = v.requiredTotal > 0 && v.requiredApproved === v.requiredTotal;
            return (
              <Link key={v.id} href={`/admin/vehicles/${v.id}`} className="block">
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">{title}</span>
                      <span className="text-xs text-foreground/50">
                        {extractLocalizedText(v.providerName, locale) || t("unknownProviderLabel")}
                        {v.modelYear ? ` · ${v.modelYear}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* LC5 — explicitly flag a document re-review (an already-approved
                          vehicle whose renewed document is awaiting review). */}
                      {v.kind === "REMEDIATION" && <Badge variant="warning">{t("vehicleReviewKindRemediation")}</Badge>}
                      <Badge variant={complete ? "success" : "info"}>
                        {t("vehicleReviewDocProgress", { approved: v.requiredApproved, total: v.requiredTotal })}
                      </Badge>
                      {v.kind === "INITIAL" && v.submittedAt && (
                        <span className="text-xs text-foreground/40">
                          {t("vehicleReviewSubmittedAtLabel")}: {formatDate(v.submittedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
                        </span>
                      )}
                      <ArrowRight size={16} strokeWidth={1.75} className="text-foreground/40 rtl:rotate-180" aria-hidden />
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
