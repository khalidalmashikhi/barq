import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/i18n/format-date";
import type { AuditEventItem } from "@/lib/admin/get-audit-events-for-entity";
import type { Locale } from "@/i18n/locales";

// Audit-history card — User & Access Management (Batch 6). Read-only server
// component, reused by the admin/staff/customer/provider detail pages. Renders
// exactly what getAuditEventsForEntity() surfaces: the raw action string (no
// invented friendly name), actor type + raw actor id, previous/new value
// snapshots, and a formatted timestamp. Never renders a secret — the values are
// only ever status/roles snapshots by writer discipline.

type AuditHistoryProps = {
  events: AuditEventItem[];
  title: string;
  emptyLabel: string;
  actorLabel: string;
  locale: Locale;
};

export function AuditHistory({ events, title, emptyLabel, actorLabel, locale }: AuditHistoryProps) {
  return (
    <Card hoverLift={false}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <History size={16} strokeWidth={1.75} className="text-foreground/40" />
        {title}
      </h2>
      {events.length === 0 ? (
        <EmptyState icon={History} iconSize={20} message={emptyLabel} gap="gap-1.5" padding="py-6" />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-border/60 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-xs font-medium text-foreground">{event.action}</code>
                <time className="text-xs text-foreground/40">
                  {formatDate(event.createdAt, locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <p className="mt-1 text-xs text-foreground/50">
                {actorLabel}: {event.actorType}
                {event.actorId ? ` · ${event.actorId}` : ""}
              </p>
              {event.previousValue != null || event.newValue != null ? (
                <p dir="ltr" className="mt-0.5 break-all text-start text-xs text-foreground/40">
                  {JSON.stringify(event.previousValue ?? null)} → {JSON.stringify(event.newValue ?? null)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
