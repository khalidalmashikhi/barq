// API v1 pagination — Gate 1 (Public API Foundation).
//
// One shared parser + serializer for the whole `/api/v1` surface. Preserves the
// existing offset `page`/`pageSize` model the domain readers already implement
// (get-services.ts, get-my-bookings.ts, get-notifications.ts), so this is a thin
// input-guard layer, not a new pagination scheme.
//
// Contract: page >= 1; pageSize >= 1; pageSize is clamped to MAX_PAGE_SIZE (50).
// The per-resource DEFAULT pageSize is supplied by the caller so each endpoint
// keeps its existing domain default (services 12, bookings 10, notifications 20).
// A missing/malformed value falls back to that default rather than erroring —
// matching how the domain readers already treat an absent pageSize.

export const MAX_PAGE_SIZE = 50;

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PaginatedDTO<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

/**
 * Parse `page`/`pageSize` from a URLSearchParams. `page` clamps to >= 1;
 * `pageSize` clamps to [1, MAX_PAGE_SIZE], defaulting to `defaultPageSize`.
 */
export function parsePageParams(searchParams: URLSearchParams, defaultPageSize: number): PageParams {
  return {
    page: clampInt(searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: clampInt(searchParams.get("pageSize"), 1, MAX_PAGE_SIZE, defaultPageSize),
  };
}

/** Shape a domain paginated result (items + metadata) into the API envelope. */
export function toPaginatedDTO<TSource, TDto>(
  source: { items: TSource[]; page: number; pageSize: number; totalCount: number; totalPages: number },
  map: (item: TSource) => TDto
): PaginatedDTO<TDto> {
  return {
    items: source.items.map(map),
    page: source.page,
    pageSize: source.pageSize,
    totalCount: source.totalCount,
    totalPages: source.totalPages,
  };
}
