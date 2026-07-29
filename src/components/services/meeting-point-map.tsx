import { MapPin } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { BrandPattern } from "@/components/ui/brand-pattern";

// Meeting Point map placeholder — Phase F.2 (goal 10). Layout/UX only,
// no external map provider integrated, per explicit instruction — no
// location field exists on Service/Provider either (same schema gap
// get-services.ts already documents for "Governorate" filtering), so
// there is no real coordinate to plot even if a map library were
// added. Reusable: swapping in a real map later only requires
// replacing this component's body, not any call site.

export async function MeetingPointMap() {
  const t = await getServerTranslator("services");

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold text-foreground">{t("meetingPointTitle")}</h2>
      <div className="relative flex h-56 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border bg-accent/5 text-center">
        <BrandPattern tone="teal" className="absolute inset-0" />
        <MapPin size={28} strokeWidth={1.5} className="relative text-foreground/25" />
        <p className="relative text-sm text-foreground/50">{t("meetingPointPlaceholderLabel")}</p>
      </div>
    </div>
  );
}
