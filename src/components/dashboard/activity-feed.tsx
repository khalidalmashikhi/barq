import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

// Recent activity feed — un-orphaned and updated for this turn's
// explicit "🕒 النشاط الأخير" section. No Activity/Booking data model
// is wired to this yet — documented here in code, not surfaced as a
// visible placeholder label in the rendered UI, per this turn's
// explicit request for the interface to look finished.

type ActivityStatus = "success" | "pending" | "cancelled";

const statusConfig: Record<ActivityStatus, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: "text-success" },
  pending: { icon: Clock, color: "text-secondary" },
  cancelled: { icon: XCircle, color: "text-danger" },
};

const activity: Array<{ title: string; time: string; status: ActivityStatus }> = [
  { title: "تأكيد حجز رحلة صحراوية", time: "قبل ساعتين", status: "success" },
  { title: "طلب حجز جديد بانتظار المراجعة", time: "قبل 5 ساعات", status: "pending" },
  { title: "إلغاء حجز من قبل العميل", time: "أمس", status: "cancelled" },
];

export function ActivityFeed() {
  return (
    <Card hoverLift={false}>
      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🕒</span>
        النشاط الأخير
      </h3>

      <ul className="mt-5 flex flex-col gap-4">
        {activity.map((item, index) => {
          const { icon: Icon, color } = statusConfig[item.status];
          return (
            <li key={index} className="flex items-start gap-3">
              <Icon size={18} strokeWidth={1.75} className={color} />
              <div className="flex flex-col">
                <span className="text-sm text-foreground/80">{item.title}</span>
                <span className="text-xs text-foreground/40">{item.time}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
