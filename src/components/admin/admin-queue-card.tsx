import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Shared operational-queue preview card — Admin Operations Platform.
//
// Every queue on the admin overview (Pending Provider Approvals,
// Bookings Awaiting Provider, Bookings In Progress, Recently
// Cancelled, Recent Reviews, plus the Provider/Customer operational
// insight lists) renders through this ONE component rather than
// hand-rolled JSX per section — a concise, bounded preview (never the
// full management table) with a real count and a "View all" link to
// the existing filtered admin list page. `items` is capped by the
// caller (the query layer already bounds every preview to 5 rows).

export type AdminQueueItem = {
  id: string;
  href: string;
  primaryText: string;
  secondaryText?: string;
};

type AdminQueueCardProps = {
  icon: LucideIcon;
  title: string;
  count: number;
  items: AdminQueueItem[];
  emptyMessage: string;
  viewAllHref: string;
  viewAllLabel: string;
};

export function AdminQueueCard({ icon: Icon, title, count, items, emptyMessage, viewAllHref, viewAllLabel }: AdminQueueCardProps) {
  return (
    <Card hoverLift={false} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon size={16} strokeWidth={1.75} className="text-foreground/40" />
          {title}
        </h2>
        <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-foreground/70">{count}</span>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Icon} iconSize={20} message={emptyMessage} gap="gap-1.5" padding="py-6" />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex flex-col rounded-xl px-2 py-1.5 transition-colors hover:bg-accent/10">
                <span className="truncate text-sm text-foreground">{item.primaryText}</span>
                {item.secondaryText && <span className="truncate text-xs text-foreground/40">{item.secondaryText}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href={viewAllHref} className="mt-auto text-xs font-medium text-primary hover:underline">
        {viewAllLabel}
      </Link>
    </Card>
  );
}
