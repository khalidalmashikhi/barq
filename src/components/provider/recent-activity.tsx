import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
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
// DATE FORMATTING (Phase A.5 Group 7): uses the shared formatDate()
// helper, which always sets timeZone to the OMAN_TIME_ZONE constant
// internally (not the server's runtime-local timezone) and resolves
// the BCP-47 tag from the current request locale via getLocale(),
// rather than a hardcoded "ar-OM" literal.

type ProviderRecentActivityProps = {
  items: ProviderRecentBookingItem[];
};

export async function ProviderRecentActivity({ items }: ProviderRecentActivityProps) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  return (
    <Card hoverLift={false}>
      <h2 className="text-lg font-semibold text-foreground">{t("recentActivityTitle")}</h2>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Inbox} message={t("noActivityLabel")} padding="py-8" />
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
                  {formatDate(new Date(item.createdAt), locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
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
