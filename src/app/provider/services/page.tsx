import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { getProviderServices } from "@/lib/provider/queries/get-provider-services";
import { getServiceStatusLabel, getServiceStatusStyle } from "@/lib/services/presentation/service-status";
import { ProviderServiceFilters } from "@/components/provider/service-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n/strings";
import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";
import type { ServiceStatus } from "@prisma/client";

// Provider Services list — Provider Dashboard Phase 1b. Read-only:
// no create/edit/delete/publish actions exist here, per explicit
// scope. Auth is handled entirely by src/app/provider/layout.tsx and,
// independently, by getProviderServices()'s own requireProvider()
// call — this page performs no auth logic of its own.
//
// ROWS, NOT CARDS OR A TABLE: mirrors the existing /bookings row-list
// convention exactly — no shared table component exists anywhere in
// this codebase, and ExperienceCard's marketing styling (Book Now CTA,
// favorite heart) is the wrong shape for a provider reviewing their
// own catalog.
//
// LINKS TO /provider/services/[id] (Phase 2): each row is now a real
// <Link>, cashing in the "carry the id cleanly" design from Phase 1b —
// same hover-shadow affordance already used by the Customer /bookings
// list for its own clickable rows. Layout, fields, styling, filters,
// and pagination are otherwise byte-for-byte unchanged.

const VALID_STATUSES: ServiceStatus[] = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"];

type SearchParams = {
  q?: string;
  status?: string;
  sort?: string;
  page?: string;
};

export default async function ProviderServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const status = VALID_STATUSES.includes(params.status as ServiceStatus) ? (params.status as ServiceStatus) : undefined;
  const sort =
    params.sort === "price_asc" || params.sort === "price_desc" ? params.sort : "newest";
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const result = await getProviderServices({ q: params.q, status, sort, page });

  const hasActiveFilter = Boolean(params.q || params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t.providerServicesTitle}</h1>

      <ProviderServiceFilters currentSearch={params.q} currentStatus={params.status} currentSort={params.sort} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={PackageOpen} message={t.providerNoServicesLabel} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={PackageOpen} message={t.providerServicesNoResultsOnPageLabel} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={PackageOpen} message={t.providerNoServicesMatchLabel} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => (
            <Link
              key={item.id}
              href={`/provider/services/${item.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-premium"
            >
              <div>
                <p className="font-medium text-foreground">{item.name}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {new Date(item.createdAt).toLocaleDateString("ar-OM", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: OMAN_TIME_ZONE,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {item.price && <span className="text-sm font-semibold text-primary">{item.price}</span>}
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getServiceStatusStyle(item.status)}`}>
                  {getServiceStatusLabel(item.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath="/provider/services" />
    </div>
  );
}
