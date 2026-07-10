import Link from "next/link";
import { ChevronRight, ChevronLeft } from "lucide-react";

type PaginationProps = {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
};

function buildHref(page: number, searchParams: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/services?${params.toString()}`;
}

export function Pagination({ page, totalPages, searchParams }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-center gap-2" aria-label="ترقيم الصفحات">
      <Link
        href={buildHref(Math.max(1, page - 1), searchParams)}
        aria-disabled={page <= 1}
        className={`rounded-full p-2 ${page <= 1 ? "pointer-events-none text-foreground/20" : "text-foreground/60 hover:bg-accent/30"}`}
      >
        <ChevronRight size={18} strokeWidth={1.75} />
      </Link>
      <span className="text-sm text-foreground/60">
        صفحة {page} من {totalPages}
      </span>
      <Link
        href={buildHref(Math.min(totalPages, page + 1), searchParams)}
        aria-disabled={page >= totalPages}
        className={`rounded-full p-2 ${page >= totalPages ? "pointer-events-none text-foreground/20" : "text-foreground/60 hover:bg-accent/30"}`}
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </Link>
    </nav>
  );
}
