import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getMyProviderVerticals, type MyVerticalRow } from "@/lib/provider/verticals/get-my-verticals";
import { requestProviderVertical } from "@/lib/provider/verticals/request-vertical";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

// Phase 3B — Phase 1. Provider-facing "request an activity" surface. A provider requests a regulated
// vertical (tourist-guide / rental-company); an admin reviews it. This capability is SEPARATE from
// the provider's business form (INDIVIDUAL/COMPANY) and from category grants — holding a category
// never authorizes a regulated listing. The page only renders; requestProviderVertical() re-derives
// all authority server-side and is the sole writer.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const VERTICAL_TYPE_LABEL_KEY = {
  TOURIST_GUIDE: "verticalTypeTouristGuide",
  RENTAL_COMPANY: "verticalTypeRentalCompany",
} as const;
const VERTICAL_TYPE_DESC_KEY = {
  TOURIST_GUIDE: "verticalTypeTouristGuideDesc",
  RENTAL_COMPANY: "verticalTypeRentalCompanyDesc",
} as const;
const STATUS_BADGE = {
  PENDING_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "danger",
} as const;
const STATUS_LABEL_KEY = {
  PENDING_REVIEW: "verticalStatusPendingReview",
  CHANGES_REQUESTED: "verticalStatusChangesRequested",
  APPROVED: "verticalStatusApproved",
  REJECTED: "verticalStatusRejected",
  SUSPENDED: "verticalStatusSuspended",
} as const;
// Only the codes requestProviderVertical() can actually return are surfaced. `as const` keeps the
// values as the literal message-key union so t() accepts them (a plain string is not assignable).
const REQUEST_ERROR_KEY = {
  INVALID_VERTICAL: "verticalReqErrorInvalid",
  VERTICAL_ALREADY_EXISTS: "verticalReqErrorAlreadyExists",
  VERTICAL_REJECTED_OR_SUSPENDED: "verticalReqErrorRejectedOrSuspended",
  NO_PROVIDER_PROFILE: "verticalReqErrorNoProfile",
  PROVIDER_NOT_ELIGIBLE: "verticalReqErrorNotEligible",
  UNKNOWN_ERROR: "verticalReqErrorUnknown",
} as const;

type Props = {
  searchParams: Promise<{ vError?: string; vNotice?: string }>;
};

export default async function ProviderVerticalsPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { vError, vNotice } = await searchParams;
  const t = await getServerTranslator("provider");

  let rows: MyVerticalRow[] | null = null;
  let notApproved = false;
  try {
    rows = await getMyProviderVerticals();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    // A not-yet-approved provider cannot request verticals — show a notice instead of the list.
    if (error instanceof ForbiddenError) {
      notApproved = true;
    } else {
      throw error;
    }
  }

  const errorMessage =
    vError && vError in REQUEST_ERROR_KEY ? t(REQUEST_ERROR_KEY[vError as keyof typeof REQUEST_ERROR_KEY]) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("verticalsPageTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("verticalsPageSubtitle")}</p>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}
      {vNotice === "requested" && <Alert variant="success">{t("verticalReqNoticeRequested")}</Alert>}
      {vNotice === "resubmitted" && <Alert variant="success">{t("verticalReqNoticeResubmitted")}</Alert>}

      {notApproved ? (
        <Card hoverLift={false}>
          <p className="text-sm text-foreground/70">{t("verticalsPageNotApproved")}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows!.map((row) => (
            <Card key={row.vertical} hoverLift={false}>
              <li className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-foreground">{t(VERTICAL_TYPE_LABEL_KEY[row.vertical])}</span>
                  {row.status && <Badge variant={STATUS_BADGE[row.status]}>{t(STATUS_LABEL_KEY[row.status])}</Badge>}
                </div>
                <p className="text-sm text-foreground/60">{t(VERTICAL_TYPE_DESC_KEY[row.vertical])}</p>

                {row.status === "CHANGES_REQUESTED" && row.reason && (
                  <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground/80">
                    <span className="font-medium">{t("verticalReasonLabel")}:</span> {row.reason}
                  </p>
                )}
                {row.status === "REJECTED" && row.reason && (
                  <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-foreground/80">
                    <span className="font-medium">{t("verticalReasonLabel")}:</span> {row.reason}
                  </p>
                )}

                {row.status === "PENDING_REVIEW" && (
                  <p className="text-xs text-foreground/50">{t("verticalReqPendingNote")}</p>
                )}
                {row.status === "APPROVED" && (
                  <p className="text-xs text-foreground/50">{t("verticalReqApprovedNote")}</p>
                )}
                {row.status === "SUSPENDED" && (
                  <p className="text-xs text-danger">{t("verticalReqSuspendedNote")}</p>
                )}

                {(row.canRequest || row.canResubmit) && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await requestProviderVertical(row.vertical);
                      if (!result.ok) {
                        redirect({ href: `/provider/verticals?vError=${result.error}`, locale });
                        return;
                      }
                      redirect({
                        href:
                          result.outcome === "resubmitted"
                            ? `/provider/verticals?vNotice=resubmitted`
                            : `/provider/verticals?vNotice=requested`,
                        locale,
                      });
                    }}
                  >
                    <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                      {row.canResubmit ? t("verticalResubmitButton") : t("verticalRequestButton")}
                    </SubmitButton>
                  </form>
                )}
              </li>
            </Card>
          ))}
        </ul>
      )}

      <Link href="/provider" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} className="rotate-180 rtl:rotate-0" />
        {t("verticalsPageBackLink")}
      </Link>
    </div>
  );
}
