import { PackageOpen } from "lucide-react";
import { getServices, getProvidersForFilter } from "@/lib/services/get-services";
import { ServiceFilters } from "@/components/services/service-filters";
import { Pagination } from "@/components/services/pagination";
import { ExperienceCard } from "@/components/dashboard/experience-card";

// Services listing page — Engineering Sprint (Services Marketplace).
//
// PUBLIC PAGE, DELIBERATELY — no requireAuth() call. This is a
// judgment call, stated directly: a browsable marketplace listing is
// conventionally public (no real tourism platform requires login to
// browse), and no approved document requires otherwise. Not decided
// silently — flagged here and in the sprint report.
//
// All filtering/search/sort/pagination state lives in the URL
// (searchParams), not client state — real server-side filtering per
// explicit requirement, shareable/bookmarkable URLs as a side benefit.
//
// No category or governorate filter UI exists here — see
// get-services.ts's note on why both are schema gaps, not omissions.

type SearchParams = {
  q?: string;
  providerId?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
};

export const metadata = {
  title: "التجارب السياحية | برق",
  description: "استكشف التجارب السياحية الموثوقة في سلطنة عُمان",
};

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [providers, result] = await Promise.all([
    getProvidersForFilter(),
    getServices({
      search: params.q,
      providerId: params.providerId,
      minPrice: params.minPrice ? Number(params.minPrice) : undefined,
      maxPrice: params.maxPrice ? Number(params.maxPrice) : undefined,
      sort: (params.sort as "newest" | "price_asc" | "price_desc" | undefined) ?? "newest",
      page: params.page ? Number(params.page) : 1,
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">التجارب السياحية</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {result.totalCount > 0 ? `${result.totalCount} تجربة متاحة` : "استكشف التجارب المتاحة"}
        </p>
      </div>

      <ServiceFilters
        providers={providers}
        currentSearch={params.q}
        currentProviderId={params.providerId}
        currentMinPrice={params.minPrice}
        currentMaxPrice={params.maxPrice}
        currentSort={params.sort}
      />

      {result.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <PackageOpen size={32} strokeWidth={1.5} className="text-foreground/25" />
          <p className="text-foreground/60">
            {params.q || params.providerId || params.minPrice || params.maxPrice
              ? "لا توجد نتائج مطابقة لبحثك"
              : "لا توجد تجارب منشورة حالياً"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((service) => (
            <ExperienceCard
                key={service.id}
                serviceId={service.id}
                title={service.name}
                providerName={service.providerName}
                price={service.price}
              />
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} />
    </main>
  );
}

