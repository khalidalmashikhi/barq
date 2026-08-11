import { CheckCircle2, Circle, Lock, ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type {
  ProviderActivation,
  ActivationStatus,
} from "@/lib/provider/activation/derive-provider-activation";

// Provider Activation / Getting Started — first-run onboarding surface
// (Product Experience Completion gate). Presentation only: it renders the state
// deriveProviderActivation() already computed from real data — it never decides
// status or invents progress. Rendered by the provider dashboard ONLY while the
// provider is approved but not yet marketplace-ready, so an experienced provider
// never sees an onboarding wall. Mobile-first, RTL-safe, no color-only status.

// `as const` so the values stay literal message keys (assignable to next-intl's
// typed t()), not widened to `string`.
const STEP_TITLE_KEY = {
  verification: "activationVerificationTitle",
  profile: "activationProfileTitle",
  firstService: "activationFirstServiceTitle",
  publish: "activationPublishTitle",
} as const;
const STEP_DESC_KEY = {
  verification: "activationVerificationDesc",
  profile: "activationProfileDesc",
  firstService: "activationFirstServiceDesc",
  publish: "activationPublishDesc",
} as const;
const STEP_CTA_KEY = {
  verification: "activationPrimaryCtaVerification",
  profile: "activationProfileTitle",
  firstService: "activationPrimaryCtaFirstService",
  publish: "activationPrimaryCtaPublish",
} as const;
const STATUS_LABEL_KEY = {
  COMPLETE: "activationStatusComplete",
  CURRENT: "activationStatusCurrent",
  BLOCKED: "activationStatusBlocked",
  OPTIONAL: "activationStatusOptional",
} as const;
const STATUS_BADGE_CLASS: Record<ActivationStatus, string> = {
  COMPLETE: "bg-success/10 text-success",
  CURRENT: "bg-primary/10 text-primary",
  BLOCKED: "bg-foreground/5 text-foreground/40",
  OPTIONAL: "bg-foreground/5 text-foreground/50",
};

export async function ProviderActivationChecklist({ activation }: { activation: ProviderActivation }) {
  const t = await getServerTranslator("provider");

  return (
    <section
      aria-labelledby="activation-heading"
      className="rounded-3xl border border-primary/15 bg-primary/[0.03] p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id="activation-heading" className="text-xl font-semibold text-foreground sm:text-2xl">
          {t("activationTitle")}
        </h2>
        <p className="max-w-xl text-sm text-foreground/60">{t("activationSubtitle")}</p>
      </div>

      {activation.primaryCtaKey && (
        <Link
          href={
            activation.steps.find((s) => s.key === activation.primaryCtaKey)?.href ?? "/provider/services/new"
          }
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {t(STEP_CTA_KEY[activation.primaryCtaKey])}
          <ArrowLeft size={16} strokeWidth={2} className="rtl:rotate-0 ltr:rotate-180" aria-hidden />
        </Link>
      )}

      <ol className="mt-6 flex flex-col gap-3">
        {activation.steps.map((step) => {
          const isActionable = step.status === "CURRENT" || step.status === "OPTIONAL";
          const StatusIcon =
            step.status === "COMPLETE" ? CheckCircle2 : step.status === "BLOCKED" ? Lock : Circle;
          const body = (
            <div className="flex items-start gap-3">
              <StatusIcon
                size={20}
                strokeWidth={2}
                aria-hidden
                className={
                  step.status === "COMPLETE"
                    ? "mt-0.5 shrink-0 text-success"
                    : step.status === "CURRENT"
                      ? "mt-0.5 shrink-0 text-primary"
                      : "mt-0.5 shrink-0 text-foreground/30"
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{t(STEP_TITLE_KEY[step.key])}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${STATUS_BADGE_CLASS[step.status]}`}
                  >
                    {t(STATUS_LABEL_KEY[step.status])}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-foreground/55">{t(STEP_DESC_KEY[step.key])}</p>
              </div>
            </div>
          );

          return (
            <li key={step.key}>
              {isActionable ? (
                <Link
                  href={step.href}
                  className="block rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  {body}
                </Link>
              ) : (
                <div className="rounded-2xl border border-border bg-card/60 p-4">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
