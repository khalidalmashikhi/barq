import { Link } from "@/i18n/navigation";
import { Compass, type LucideIcon } from "lucide-react";

// CategoryDiscoveryCard — the single customer-facing category card used on the
// homepage discovery grid (categories-section.tsx) and reused verbatim by the
// admin category preview, so both share one visual representation (Unified
// Preview System). Presentation only — no placement concept, no
// showOnHomepage/isFeatured.
//
// `interactive` (default true) renders the live public discovery link
// (/services?category=slug). The admin preview passes interactive={false} to
// show the exact card visual without navigating (a HIDDEN/ARCHIVED category has
// no public discovery destination yet).

const CARD_CLASSNAME =
  "group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

type CategoryDiscoveryCardProps = {
  slug: string;
  label: string;
  /** Optional short customer-oriented description shown under the label. */
  description?: string;
  Icon?: LucideIcon;
  interactive?: boolean;
};

export function CategoryDiscoveryCard({ slug, label, description, Icon = Compass, interactive = true }: CategoryDiscoveryCardProps) {
  const inner = (
    <>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <span className="text-sm font-semibold text-foreground/90">{label}</span>
      {description ? <span className="text-xs leading-relaxed text-foreground/50">{description}</span> : null}
    </>
  );

  if (!interactive) {
    return <div className={CARD_CLASSNAME}>{inner}</div>;
  }

  return (
    <Link href={`/services?category=${slug}`} className={CARD_CLASSNAME}>
      {inner}
    </Link>
  );
}
