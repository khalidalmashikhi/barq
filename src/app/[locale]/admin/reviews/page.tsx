import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Star } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getReviews } from "@/lib/admin/get-reviews";
import { moderateReview } from "@/lib/admin/moderate-review";
import { availableModerationActions, type ReviewModerationAction } from "@/lib/admin/review-moderation-policy";
import { isReviewAdminActionErrorCode, getReviewAdminErrorTranslationKey } from "@/lib/admin/review-admin-errors";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import type { ReviewModerationState } from "@prisma/client";

// Admin Reviews — Admin Operations Platform.
//
// REVIEW TRUST & SAFETY: this surface now carries operational moderation. Each review card offers
// the state-appropriate actions (Flag / Remove / Republish) via the moderateReview server action —
// gated by requireAdmin(), guarded + audited server-side. Moderation changes public VISIBILITY only
// (moderationState); the review row is never hard-deleted. Every public/aggregate surface already
// filters moderationState:"PUBLISHED", so a Flagged/Removed review disappears from all public views
// and rating aggregates without any change to those queries. The moderationState filter above lets
// an admin find flagged/removed reviews for review.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const MODERATION_STATES: ReviewModerationState[] = ["PUBLISHED", "FLAGGED", "REMOVED"];
const RATINGS = [5, 4, 3, 2, 1];

type SearchParams = {
  moderationState?: string;
  providerId?: string;
  customerId?: string;
  bookingId?: string;
  rating?: string;
  page?: string;
  error?: string;
};

// The moderation action button label per action (all in the "admin" namespace). `as const satisfies`
// keeps the literal key types so the translator accepts them.
const MODERATION_BUTTON_KEY = {
  FLAG: "reviewModerationFlagButton",
  REMOVE: "reviewModerationRemoveButton",
  RESTORE: "reviewModerationRepublishButton",
} as const satisfies Record<ReviewModerationAction, string>;

// Rebuild the current filter/pagination query (never the transient `error`) so a moderation
// redirect returns the admin to the same filtered view.
function buildReviewsQuery(params: SearchParams, extra?: { error?: string }): string {
  const qs = new URLSearchParams();
  if (params.moderationState) qs.set("moderationState", params.moderationState);
  if (params.providerId) qs.set("providerId", params.providerId);
  if (params.customerId) qs.set("customerId", params.customerId);
  if (params.bookingId) qs.set("bookingId", params.bookingId);
  if (params.rating) qs.set("rating", params.rating);
  if (params.page) qs.set("page", params.page);
  if (extra?.error) qs.set("error", extra.error);
  const s = qs.toString();
  return s ? `/admin/reviews?${s}` : "/admin/reviews";
}

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const moderationState = MODERATION_STATES.includes(params.moderationState as ReviewModerationState)
    ? (params.moderationState as ReviewModerationState)
    : undefined;
  const ratingParsed = params.rating ? Number(params.rating) : undefined;
  const rating = ratingParsed && RATINGS.includes(ratingParsed) ? ratingParsed : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let result;
  try {
    result = await getReviews({
      moderationState,
      providerId: params.providerId,
      customerId: params.customerId,
      bookingId: params.bookingId,
      rating,
      page,
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const hasActiveFilter = Boolean(params.moderationState || params.providerId || params.customerId || params.bookingId || params.rating);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const reviewsBasePath = getPathname({ href: "/admin/reviews", locale });

  const moderationBadgeVariant: Record<ReviewModerationState, "success" | "warning" | "danger"> = {
    PUBLISHED: "success",
    FLAGGED: "warning",
    REMOVED: "danger",
  };

  // Never trust the ?error= query param — translate it only if it is a known review-admin code.
  const errorMessage =
    params.error && isReviewAdminActionErrorCode(params.error) ? t(getReviewAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("reviewsAdminTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("reviewsAdminDescription")}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <form method="get" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <select
          name="moderationState"
          defaultValue={params.moderationState ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">{t("reviewModerationStateAllLabel")}</option>
          <option value="PUBLISHED">{t("reviewModerationStatePublishedLabel")}</option>
          <option value="FLAGGED">{t("reviewModerationStateFlaggedLabel")}</option>
          <option value="REMOVED">{t("reviewModerationStateRemovedLabel")}</option>
        </select>
        <select
          name="rating"
          defaultValue={params.rating ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">{t("reviewRatingAllLabel")}</option>
          {RATINGS.map((value) => (
            <option key={value} value={value}>
              {t("reviewRatingOptionLabel", { value })}
            </option>
          ))}
        </select>
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("applyReviewFiltersButton")}
        </button>
      </form>

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={Star} message={t("noReviewsAdminLabel")} description={t("noReviewsAdminDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={Star} message={t("reviewsNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={Star} message={t("noReviewsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((review) => (
            <div key={review.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{review.rating}/5</span>
                  <Badge variant={moderationBadgeVariant[review.moderationState]}>
                    {t(
                      review.moderationState === "PUBLISHED"
                        ? "reviewModerationStatePublishedLabel"
                        : review.moderationState === "FLAGGED"
                          ? "reviewModerationStateFlaggedLabel"
                          : "reviewModerationStateRemovedLabel"
                    )}
                  </Badge>
                </div>
                <span className="text-xs text-foreground/40">
                  {formatDate(review.createdAt, locale, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <p className="text-sm text-foreground/80">{review.content}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/50">
                <span dir="ltr">{review.customerPhoneNumber ?? "—"}</span>
                <Link href={`/admin/providers/${review.providerId}`} className="hover:text-foreground hover:underline">
                  {review.providerName}
                </Link>
                <span>{review.serviceName}</span>
                <Link href={`/admin/bookings/${review.bookingId}`} className="hover:text-foreground hover:underline">
                  {t("viewReviewBookingLabel")}
                </Link>
              </div>

              {/* REVIEW TRUST & SAFETY — moderation controls, offered ONLY for the actions valid from
                  this review's current state (Published→Flag/Remove; Flagged→Remove/Republish;
                  Removed→Republish). One form per card: an optional reason plus a submit button per
                  action (name="action"). "Remove" is a public takedown (moderationState), never a
                  DB delete. moderateReview re-validates authority + the transition server-side. */}
              {(() => {
                const actions = availableModerationActions(review.moderationState);
                if (actions.length === 0) return null;
                return (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const result = await moderateReview(review.id, formData);
                      redirect({
                        href: buildReviewsQuery(params, result.ok ? undefined : { error: result.error }),
                        locale,
                      });
                    }}
                    className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
                  >
                    <input
                      type="text"
                      name="reason"
                      maxLength={500}
                      placeholder={t("reviewModerationReasonPlaceholder")}
                      className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    {actions.map((action) => (
                      <SubmitButton
                        key={action}
                        type="submit"
                        name="action"
                        value={action}
                        className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          action === "REMOVE"
                            ? "border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
                            : action === "RESTORE"
                              ? "border border-success/30 bg-success/5 text-success hover:bg-success/10"
                              : "border border-warning/30 bg-warning/5 text-warning hover:bg-warning/10"
                        }`}
                      >
                        {t(MODERATION_BUTTON_KEY[action])}
                      </SubmitButton>
                    ))}
                  </form>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={reviewsBasePath} />
    </div>
  );
}
