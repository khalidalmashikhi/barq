import Link from "next/link";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Shared pagination control — Engineering Sprint (Booking List
// Pagination stabilization). Moved here from
// src/components/services/pagination.tsx and generalized with a
// `basePath` prop so it can be reused by any URL-driven, server-
// rendered paginated list (currently /services and /bookings), rather
// than staying hardcoded to the marketplace alone.
//
// RTL-correct by design, unchanged from the original: ChevronRight is
// "previous"/back and ChevronLeft is "next"/forward, since that is the
// visually-correct direction in RTL — not an LTR layout mirrored
// after the fact.
//
// INTERNATIONALIZATION PHASE A.5: migrated from strings.ts's flat
// t.paginationPageLabel/t.paginationOfLabel (two separate keys
// concatenated with raw numbers in JSX) to a single ICU-interpolated
// common.paginationStatus message ("Page {page} of {totalPages}") —
// per I18N_MESSAGE_CONVENTIONS.md §7's interpolation guidance, this is
// one real message with two placeholders, not three concatenated
// pieces. Output is byte-identical to the previous concatenation for
// both ar/en. This component is a Server Component (no "use client"),
// so it uses getServerTranslator, not useTranslations.

type PaginationProps = {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
  basePath: string;
};

function buildHref(
  basePath: string,
  page: number,
  searchParams: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

export async function Pagination({ page, totalPages, searchParams, basePath }: PaginationProps) {
  if (totalPages <= 1) return null;

  const t = await getServerTranslator("common");

  return (
    <nav className="flex items-center justify-center gap-2" aria-label={t("paginationAriaLabel")}>
      <Link
        href={buildHref(basePath, Math.max(1, page - 1), searchParams)}
        aria-disabled={page <= 1}
        className={`rounded-full p-2 ${page <= 1 ? "pointer-events-none text-foreground/20" : "text-foreground/60 hover:bg-accent/30"}`}
      >
        <ChevronRight size={18} strokeWidth={1.75} />
      </Link>
      <span className="text-sm text-foreground/60">{t("paginationStatus", { page, totalPages })}</span>
      <Link
        href={buildHref(basePath, Math.min(totalPages, page + 1), searchParams)}
        aria-disabled={page >= totalPages}
        className={`rounded-full p-2 ${page >= totalPages ? "pointer-events-none text-foreground/20" : "text-foreground/60 hover:bg-accent/30"}`}
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </Link>
    </nav>
  );
}
