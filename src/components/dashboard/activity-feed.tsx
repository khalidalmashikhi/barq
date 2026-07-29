import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
      <EmptyState icon={History} message={t("noActivityLabel")} className="mt-6 border-none" padding="py-6" />
    </Card>
  );
}
