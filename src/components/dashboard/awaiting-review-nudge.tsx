import { Star, ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Awaiting Review nudge — Customer Experience Platform.
//
// LINKS TO THE NEW /reviews PAGE, NEVER DUPLICATES THE REVIEW FORM:
// this banner only ever appears when `count > 0` (a real, computed
// booking.count({status:"COMPLETED", review:null}) from
// getDashboardData()) and its only action is a link to /reviews, whose
// own "Awaiting Review" section links onward to the existing booking
// detail page — the one and only place a review is actually submitted
// (create-review.ts's form). No mutation, no review UI lives here.

type AwaitingReviewNudgeProps = {
  count: number;
};

export async function AwaitingReviewNudge({ count }: AwaitingReviewNudgeProps) {
  const t = await getServerTranslator("dashboard");

  return (
    <Link
      href="/reviews"
      className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 text-sm transition-colors hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-foreground">
        <Star size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="flex-1 font-medium text-accent-foreground">{t("awaitingReviewNudgeLabel", { count })}</span>
      <ChevronLeft size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-foreground/60" />
    </Link>
  );
}
