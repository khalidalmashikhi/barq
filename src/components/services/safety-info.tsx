import { Users, Building2, MapPinned } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Safety information — Phase F.4 (goal 3, Safety Information). No
// per-service safety data exists on the Service model, so this is
// general responsibility/guidance content (not fabricated per-service
// facts) — the same "honest placeholder" pattern as MeetingPointMap's
// "coming soon" map view, which this section links back to.

export async function SafetyInfo() {
  const t = await getServerTranslator("services");

  const items = [
    { icon: Users, titleKey: "safetyCustomerTitle", bodyKey: "safetyCustomerBody" },
    { icon: Building2, titleKey: "safetyProviderTitle", bodyKey: "safetyProviderBody" },
    { icon: MapPinned, titleKey: "safetyMeetingPointTitle", bodyKey: "safetyMeetingPointBody" },
  ] as const;

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold text-foreground">{t("safetyTitle")}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map(({ icon: Icon, titleKey, bodyKey }) => (
          <div key={titleKey} className="rounded-2xl border border-border bg-card p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <h3 className="mt-3 text-sm font-medium text-foreground">{t(titleKey)}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/70">{t(bodyKey)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
