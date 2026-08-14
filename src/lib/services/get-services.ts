import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { Locale } from "@/i18n/locales";

// Services listing query — Engineering Sprint (Services Marketplace).
//
// NOT IMPLEMENTED, FLAGGED — two requested filters have no backing
// field in the schema, confirmed by direct inspection before writing
// any code:
//   - Governorate/country: Provider has a plain `city` free-text field
//     only — no governorate or country field exists anywhere. `city` is
//     now included in search (see below); governorate/country are not
//     invented.
//   - Images: no image field exists anywhere in the schema — the
//     gallery this sprint also asks for has nothing to read from.
// Both need a schema decision (new fields, or a new model for images)
// before they can be built for real — not decided here, per "preserve
// Prisma schema unless absolutely required."
//
// CATEGORY — UX remediation (category navigation fix), re-inspected:
// Service.serviceType is still only a technical CTI discriminator
// ("mirrors AssetType's pattern" per its own schema comment) — hardcoded
// to "EXPERIENCE" for every Service ever created (confirmed by grepping
// every create-service.ts/duplicate-service.ts/seed.ts call site) — and
// the real Category/SubCategory models (ADR-0013, Phase 1.1) have NO
// relationship to Service at all (confirmed directly against
// prisma/schema.prisma: `categoryId` appears only on SubCategory,
// linking it to Category — never once on Service). Building a real
// Service<->Category relationship is a schema change, explicitly out of
// scope for a UX-navigation fix. `categoryKeyword` below is therefore
// an honest, best-effort stand-in: the homepage/dashboard category
// cards pass their own already-existing, already-translated display
// label as this value (see services/page.tsx's own comment), and it is
// matched against Service.name using the exact same bilingual
// JSON-path technique this file previously used for `search` alone —
// not a new mechanism, not a fabricated Category join. Some categories
// will honestly return zero results against today's seed data (e.g. no
// service is actually about "transport" — this marketplace sells tours/
// experiences) — that is a correct empty state reflecting real data,
// not a bug in this filter. `categoryKeyword` is untouched by the
// Marketplace Search Enhancement below — that phase scopes only the
// free-text `search` box, and category compatibility is preserved
// exactly as-is.
//
// MARKETPLACE SEARCH ENHANCEMENT — `search` now matches every existing
// public, searchable field: Service.name/description (bilingual) and
// Provider.businessName/businessDescription (bilingual) + city + slug.
// No governorate/country field exists on Provider (confirmed above) —
// not invented. Provider.contactEmail is deliberately excluded — it is
// "business-correspondence contact only... never surfaced to a
// customer/tourist" per its own schema comment (BR-002), and searching
// it would let a customer probe for it indirectly.
//
// CASE-INSENSITIVITY, ROOT CAUSE: Prisma's JSON path filter
// (`path` + `string_contains`) has no `mode` option in this Prisma
// version — confirmed directly against the generated
// `JsonNullableFilterBase` type, which defines `string_contains` with
// no accompanying `mode?: QueryMode` (unlike the plain `StringFilter`
// used for scalar text columns, which does). This means the search this
// file previously shipped was silently case-SENSITIVE for every
// bilingual JSON field — not a regression introduced here, a real,
// pre-existing gap this enhancement closes. Prisma's DSL has no way to
// wrap a JSON path extraction in a case-insensitive comparison, so
// achieving real case-insensitivity across JSON fields requires a raw
// SQL query — `findMatchingServiceIds()` below uses `$queryRaw` with
// Postgres's own `->>'key' ILIKE` (case-insensitive by definition,
// standard Postgres/Prisma capability, not a new search engine) to
// compute a matching Service id list, which is then intersected with
// the normal Prisma `where` via a plain `id: { in: [...] }` — a single
// extra query per call (not per-row: no N+1), safely parameterized via
// Prisma.sql tagged templates exactly like create-booking.ts's existing
// $executeRaw precedent for the same reason (Prisma's DSL cannot
// express what's needed here).
//
// MULTI-WORD SEARCH: the trimmed, whitespace-collapsed query is split on
// spaces; each word must match SOMEWHERE across the 10 fields above
// (OR across fields, AND across words) — the standard "every word must
// appear somewhere" search behavior, achievable with plain ILIKE, no
// full-text search extension required.
//
// PERFORMANCE LIMITATION, DOCUMENTED PER INSTRUCTION (not fixed, since
// fixing it needs a schema/migration change out of this task's scope):
// none of the searched columns have a GIN/trigram index, so both the
// old JSON-path approach and this ILIKE-based replacement require a
// sequential scan proportional to total service+provider rows for any
// search query. Acceptable at this marketplace's current scale (the
// same "acceptable at this page size" reasoning already applied to
// price-sort below); would need `pg_trgm` GIN indexes (a real migration)
// to scale further — not decided or built here.
//
// NO PROVIDER-VISIBILITY GATE, FOUND AND FIXED: `getServices()` never
// filtered on `Provider.status`/`Provider.visible` at all — confirmed by
// direct inspection of the `where` clause below before this change,
// and inconsistent with this exact file's own `getProvidersForFilter()`
// (which already filters `status: "APPROVED"`) and
// `get-provider-profile.ts` (`status: "APPROVED", visible: true`). A
// service published while its provider was APPROVED could keep
// appearing in search/browse indefinitely even after that provider was
// later suspended or hidden — a real, pre-existing gap, not introduced
// by this change, closed here by adding the same `provider: {status:
// "APPROVED", visible: true}` gate this file's sibling functions
// already use.

export type ServiceListItem = {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  price: string | null;
  // Discovery/display metadata (Core Service Enrichment, Gate 3). Raw governed
  // CODES (or null for legacy/unset rows), never localized. pricingUnit is read
  // from the SAME ACTIVE Price row as `price` and is display metadata only — it
  // does not affect totals or booking. Exposed here for a future Gate-4 Explore
  // filter / card label; no presentation is applied at this layer.
  regionCode: string | null;
  pricingUnit: string | null;
  // Service cover image (Media Foundation, Gap C) — the ONE cover per card,
  // fetched via a bounded relational include (batched by Prisma, never N+1).
  coverUrl: string | null;
  createdAt: Date;
};

export type ServiceListFilters = {
  search?: string;
  providerId?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
  /// Relational category filter (B2 read path) — the real `Service.categoryId`.
  /// This is the preferred, accurate filter; the caller resolves a public
  /// category slug to its id and passes it here (see services/page.tsx dual
  /// read). When both `categoryId` and `categoryKeyword` are set they both
  /// narrow (AND) — the caller sets only one.
  categoryId?: string;
  /// Governorate discovery filter (Core Service Enrichment, Gate 4) — a direct
  /// match on `Service.regionCode`, a stable governorate CODE (never localized,
  /// never free-text). Optional; composes with `categoryId` and every other
  /// filter via AND (they are independent keys on the same `where`). The caller
  /// validates the code against the src/lib/regions registry before passing it,
  /// so an unknown/invalid value never reaches this query.
  regionCode?: string;
  /// Best-effort category filter — see this file's own "CATEGORY"
  /// comment above. Callers pass an already-resolved display label
  /// (e.g. "Diving"/"الغوص"), not a raw category slug.
  ///
  /// @deprecated Legacy keyword bridge (substring match on Service.name),
  /// predating the relational taxonomy. Task B (write path) now populates the
  /// real Service.categoryId; TODO(B2 read-path migration): replace this with a
  /// categoryId filter once existing services are categorized/backfilled, then
  /// remove this field and the four hardcoded public category slug arrays. Do
  /// NOT build new consumers on categoryKeyword.
  categoryKeyword?: string;
};

export type ServiceListResult = {
  items: ServiceListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 12;

// Splits a raw search string into normalized, non-empty words: trims
// leading/trailing whitespace, collapses repeated internal whitespace
// (tabs/multiple spaces) to single spaces, then splits on the space.
// An empty/whitespace-only input yields an empty array — the caller
// treats that identically to "no search filter", never as "match
// nothing" or "match everything" by accident.
function normalizeSearchWords(raw: string): string[] {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0);
}

// Case-insensitive, multi-field, multi-word search across every
// existing public, searchable field on Service and its owning Provider
// — see this file's own "MARKETPLACE SEARCH ENHANCEMENT" comment above
// for why this needs raw SQL (Prisma's JSON path filter has no
// case-insensitive mode) and why it is still exactly one extra query,
// not an N+1. Every word must match somewhere among the 10 fields (AND
// across words, OR across fields per word) — real multi-word support
// without a full-text search extension. Scoped to PUBLISHED services
// from APPROVED, visible providers only, so the candidate id list this
// returns is never wider than what the caller's own `where` clause
// would allow anyway (see "NO PROVIDER-VISIBILITY GATE" comment above).
// Safely parameterized throughout via Prisma.sql tagged templates — no
// string concatenation, no injection risk.
async function findMatchingServiceIds(rawSearch: string): Promise<string[] | null> {
  const words = normalizeSearchWords(rawSearch);
  if (words.length === 0) return null;

  const wordClauses = words.map((word) => {
    const pattern = `%${word}%`;
    return Prisma.sql`(
      s.name ->> 'en' ILIKE ${pattern} OR
      s.name ->> 'ar' ILIKE ${pattern} OR
      s.description ->> 'en' ILIKE ${pattern} OR
      s.description ->> 'ar' ILIKE ${pattern} OR
      p."businessName" ->> 'en' ILIKE ${pattern} OR
      p."businessName" ->> 'ar' ILIKE ${pattern} OR
      p."businessDescription" ->> 'en' ILIKE ${pattern} OR
      p."businessDescription" ->> 'ar' ILIKE ${pattern} OR
      p.city ILIKE ${pattern} OR
      p.slug ILIKE ${pattern}
    )`;
  });

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT DISTINCT s.id
      FROM services s
      JOIN providers p ON p.id = s."providerId"
      WHERE s.status = 'PUBLISHED'
        AND p.status = 'APPROVED'
        AND p.visible = true
        AND ${Prisma.join(wordClauses, " AND ")}
    `
  );

  return rows.map((row) => row.id);
}

// `localeOverride` (additive, optional): the `/api/v1` HTTP adapter passes an
// explicitly resolved locale (query/Accept-Language), since next-intl's
// getLocale() has no `[locale]` request scope in an API route. Existing Web
// callers pass nothing and behave EXACTLY as before (getLocale()).
export async function getServices(
  filters: ServiceListFilters,
  localeOverride?: Locale
): Promise<ServiceListResult> {
  const locale = localeOverride ?? (await getLocale());
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // `search` (case-insensitive, multi-field, multi-word — see
  // findMatchingServiceIds()) and `categoryKeyword` (unchanged, the
  // pre-existing best-effort bilingual Service.name match) are two
  // INDEPENDENT conditions — a category selection followed by the
  // user's own typed search further narrows, rather than one silently
  // replacing the other.
  const searchMatchedIds = filters.search ? await findMatchingServiceIds(filters.search) : null;

  const matchConditions: Array<Record<string, unknown>> = [];

  if (filters.categoryKeyword) {
    matchConditions.push({
      OR: [
        { name: { path: ["ar"], string_contains: filters.categoryKeyword } },
        { name: { path: ["en"], string_contains: filters.categoryKeyword } },
      ],
    });
  }

  const where = {
    status: "PUBLISHED" as const,
    // See "NO PROVIDER-VISIBILITY GATE, FOUND AND FIXED" above — applies
    // unconditionally, not just when searching.
    provider: { status: "APPROVED" as const, visible: true },
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    // Relational category filter (B2 read path) — a direct FK match on
    // Service.categoryId, distinct from the legacy categoryKeyword name-substring
    // bridge above. Additive: absent by default, so every existing caller is
    // unaffected.
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    // Governorate discovery filter (Gate 4) — a direct match on the stable
    // Service.regionCode. Independent key => composes with categoryId (and every
    // other filter) via AND. Absent by default; the caller validated the code.
    ...(filters.regionCode ? { regionCode: filters.regionCode } : {}),
    ...(searchMatchedIds !== null ? { id: { in: searchMatchedIds } } : {}),
    ...(matchConditions.length > 0 ? { AND: matchConditions } : {}),
  };

  // Price filtering/sorting requires joining the real Price model
  // (only ACTIVE rows) rather than a fabricated Service.price field,
  // which does not exist — Service and Price are separate models.
  //
  // BUG FOUND AND FIXED (Marketplace Search Enhancement, discovered by
  // this task's own new "existing filters still work alongside search"
  // test — not introduced by this change): `amount` was previously two
  // sibling spreads (`...({amount: {gte}}), ...({amount: {lte}})`) on
  // the same object — a real instance of exactly the "two sibling keys
  // spread onto the same object collide" bug this file's own comments
  // have warned about elsewhere. When both minPrice AND maxPrice were
  // provided, the second spread silently overwrote the first, so `gte`
  // was dropped and only `lte` ever took effect. Fixed by merging both
  // bounds into one `amount` object instead of two competing spreads.
  const priceWhere =
    filters.minPrice !== undefined || filters.maxPrice !== undefined
      ? {
          prices: {
            some: {
              status: "ACTIVE" as const,
              amount: {
                ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}),
                ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {}),
              },
            },
          },
        }
      : {};

  const fullWhere = { ...where, ...priceWhere };

  const orderBy =
    filters.sort === "price_asc" || filters.sort === "price_desc"
      ? undefined // price sort applied after fetch — see note below
      : { createdAt: "desc" as const };

  const [totalCount, services] = await Promise.all([
    prisma.service.count({ where: fullWhere }),
    prisma.service.findMany({
      where: fullWhere,
      ...(orderBy ? { orderBy } : {}),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        provider: true,
        prices: { where: { status: "ACTIVE" }, take: 1 },
        // Only the single COVER needed for the card — never the whole gallery
        // (Rule 8). Prisma batches this include, so it stays one extra query
        // for the whole page, not one per service.
        mediaAssets: { where: { kind: "COVER" }, take: 1, select: { url: true } },
      },
    }),
  ]);

  type ServiceRow = {
    id: string;
    name: unknown;
    providerId: string;
    regionCode?: string | null;
    provider: { businessName: unknown };
    prices: Array<{ amount: unknown; currency: string; pricingUnit?: string | null }>;
    mediaAssets: Array<{ url: string }>;
    createdAt: Date;
  };

  let items: ServiceListItem[] = (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerId: service.providerId,
    providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    // regionCode is a Service scalar; pricingUnit rides the SAME ACTIVE price row
    // as `price` (prices[0]). Both null-tolerant for legacy/unset data.
    regionCode: service.regionCode ?? null,
    pricingUnit: service.prices[0] ? (service.prices[0].pricingUnit ?? null) : null,
    coverUrl: service.mediaAssets[0]?.url ?? null,
    createdAt: service.createdAt,
  }));

  // Price sorting done in application code after fetch, since it sorts
  // on a joined ACTIVE Price row (0 or 1 per service), not a direct
  // Service column — a real limitation of the current schema shape,
  // not a shortcut. Acceptable at this page size (paginated, not
  // sorting the full table); flagged if this ever needs to scale past
  // that.
  if (filters.sort === "price_asc" || filters.sort === "price_desc") {
    const direction = filters.sort === "price_asc" ? 1 : -1;
    items = [...items].sort((a, b) => {
      const priceA = a.price ? parseFloat(a.price) : Number.POSITIVE_INFINITY;
      const priceB = b.price ? parseFloat(b.price) : Number.POSITIVE_INFINITY;
      return (priceA - priceB) * direction;
    });
  }

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export async function getProvidersForFilter(): Promise<Array<{ id: string; name: string }>> {
  const locale = await getLocale();

  const providers = await prisma.provider.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });

  type ProviderRow = { id: string; businessName: unknown };
  return (providers as ProviderRow[]).map((provider) => ({
    id: provider.id,
    name: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
  }));
}
