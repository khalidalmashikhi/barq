import { ShieldCheck, History, CalendarClock } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Booking trust panel — Phase F.4 (goal 1, Trust Signals). Every line
// here maps to a real, already-shipped feature: "Secure booking" and
// "Booking protection" describe the real booking-lifecycle audit
// trail (BookingStatusEvent, Phase E.1's BookingTimeline), and the
// cancellation note mirrors the exact real rule in
// cancellation-policy.ts (CREATED/CONFIRMED only). No fabricated
// badge (license/government) is shown — the Verified Provider badge
// already covers the one real verification signal (ProviderStatus)
// and lives on ProviderProfileCard, not duplicated here.

export async function BookingTrustPanel() {
  const t = await getServerTranslator("services");

  const items = [
    { icon: ShieldCheck, labelKey: "secureBookingLabel", descKey: "secureBookingDescription" },
    { icon: History, labelKey: "bookingProtectionLabel", descKey: "bookingProtectionDescription" },
    { icon: CalendarClock, labelKey: "cancellationNoticeLabel", descKey: "cancellationNoticeDescription" },
  ] as const;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      {items.map(({ icon: Icon, labelKey, descKey }) => (
        <div key={labelKey} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
            <Icon size={15} strokeWidth={1.75} />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{t(labelKey)}</span>
            <span className="text-sm leading-relaxed text-foreground/65">{t(descKey)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
