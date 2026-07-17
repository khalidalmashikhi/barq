import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Recent activity (🕒) — no customer-facing Activity model exists.
// BARQ's Audit Log (DATABASE_DESIGN.md) is a separate, staff/admin-
// facing concept, not something this widget can safely repurpose
// without inventing a new feature. Honest empty state.

export async function ActivityFeed() {
  const t = await getServerTranslator("dashboard");

  return (
    <Card hoverLift={false}>
      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🕒</span>
        {t("recentActivityTitle")}
      </h3>
      <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
        <History size={28} strokeWidth={1.5} className="text-foreground/25" />
        <p className="text-sm text-foreground/50">{t("noActivityLabel")}</p>
      </div>
    </Card>
  );
}
