import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { t } from "@/lib/i18n/strings";
import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";
import type { ProviderRecentBookingItem } from "@/lib/provider/queries/get-provider-overview";

// Provider Recent Activity — Provider Dashboard Phase 1a, reused by
// Phase 2's Service Detail Workspace for its own bookings preview
// (ProviderBookingListItem is a structural superset of the
// ProviderRecentBookingItem shape this component expects, so it
// type-checks unchanged).
//
// A short (max 5), read-only display list — not a table, no actions,
// no links to a detail/edit view — deliberately staying inside this
// phase's "no booking management" boundary. Reuses getBookingStatusLabel/
// getBookingStatusStyle directly (no new status map) and EmptyState
// directly (no new empty-state pattern). Does not display the
// customer's phone number or any customer identity — that remains an
// open product/privacy decision flagged separately, not needed here.
//
// DATE FORMATTING, FIXED (Phase 2): now explicitly formats in
// Asia/Muscat, not the server's runtime-local timezone — the previous
// call relied on the "ar-OM" locale alone, which affects language/
// numeral conventions but not which timezone a date is rendered in.
// Now imports the shared OMAN_TIME_ZONE constant (timezone-consistency
// follow-up pass), the same one used by the standalone
// /provider/services, /provider/bookings, /provider/availability, and
// /provider/services/[id] pages, rather than a hardcoded literal.

type ProviderRecentActivityProps = {
  items: ProviderRecentBookingItem[];
};

export function ProviderRecentActivity({ items }: ProviderRecentActivityProps) {
  return (
    <Card hoverLift={false}>
      <h2 className="text-lg font-semibold text-foreground">{t.providerRecentActivityTitle}</h2>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Inbox} message={t.providerNoActivityLabel} padding="py-8" />
        </div>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{item.serviceName}</p>
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
                {item.priceSnapshot && <span className="text-sm font-semibold text-primary">{item.priceSnapshot}</span>}
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(item.status)}`}>
                  {getBookingStatusLabel(item.status)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
