import { Star, MessageSquareText } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { EmptyState } from "@/components/ui/empty-state";

// Reviews — Phase F.2 (goal 9). Reusable, but PLACEHOLDER ONLY per
// explicit instruction: no getReviews() query was written, and no
// review is fabricated here. `Review`/`Rating` already exist in
// schema.prisma (Customer Context) but no app code anywhere reads
// them yet — wiring that up is a future phase's data-access decision,
// not this one's. This component accepts an optional, already-typed
// `reviews` prop so that future wiring is purely a data change (same
// precedent as ServiceGallery's own empty state) — today every caller
// passes nothing, so the honest empty state always renders.

export type ReviewItem = {
  id: string;
  customerLabel: string;
  rating: number;
  content: string;
  createdAt: Date;
};

type ReviewsSectionProps = {
  reviews?: ReviewItem[];
};

export async function ReviewsSection({ reviews = [] }: ReviewsSectionProps) {
  const t = await getServerTranslator("services");

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold text-foreground">{t("reviewsTitle")}</h2>

      {reviews.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          message={t("reviewsEmptyLabel")}
          description={t("reviewsEmptyDescription")}
          padding="py-12"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{review.customerLabel}</span>
                <span className="flex items-center gap-1 text-xs font-medium text-accent-foreground">
                  <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                  {review.rating.toFixed(1)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">{review.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
