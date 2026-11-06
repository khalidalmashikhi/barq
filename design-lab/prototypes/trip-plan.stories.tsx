import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { Button } from "../components/button";
import { Notice } from "../components/notice";
import { StateView } from "../components/state-view";
import { BarqServiceCard, GeneralSuggestionCard, TripDayTimeline } from "../components/trip";
import { useLabCopy } from "../copy";
import { FOCUS_RING } from "../tokens";
import { BrowseShell } from "./shell";

// Prototype 3 — trip plan (Storybook only; src/app/[locale]/trips/_components/trip-planner.tsx is
// unchanged). One disclaimer, the preferences as editable chips, each day ONE section with period rows.
// When the region has no BARQ services the screen says so ONCE (empty state) instead of repeating nine
// identical general-suggestion cards. Copy comes from trips.json; the deterministic planner never claims
// AI, verification or guaranteed prices/availability. Services and prices are synthetic.

type PlanState = "mixed" | "noServices" | "loading" | "rateLimited" | "partial";

function Chips() {
  const c = useLabCopy();
  const t = useTranslations("trips");
  const chip = `inline-flex min-h-11 items-center rounded-full border-[1.5px] border-foreground/20 bg-card px-4 text-[1rem] font-medium ${FOCUS_RING}`;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chip}>
        {c.tripSummary}
      </button>
      <button type="button" className={chip} aria-label={`${t("changePace")}: ${c.pace}`}>
        {c.pace}
      </button>
      <button type="button" className={`${chip} text-primary`}>
        {t("editPreferences")}
      </button>
    </div>
  );
}

function Day({ n, withService }: { n: number; withService: boolean }) {
  const t = useTranslations("trips");
  const c = useLabCopy();
  return (
    <TripDayTimeline title={t("dayTitle", { number: n })} regenerateLabel={t("regenerateDay")} footer={withService ? t("dayCost", { range: c.range1 }) : undefined}>
      {withService ? (
        <BarqServiceCard period={t("period_morning")} title={c.serviceSynthetic} badge={t("badgeCheckOnBooking")} cost={t("estimatedCost", { range: c.range1 })} duration={t("durationLabel", { duration: c.hours4 })} viewLabel={c.view} replaceLabel={t("replace")} />
      ) : (
        <GeneralSuggestionCard period={t("period_morning")} title={t("suggestionHeritageWalk")} badge={t("badgeGeneral")} />
      )}
      <GeneralSuggestionCard period={t("period_afternoon")} title={t("suggestionFreeTime")} badge={t("badgeGeneral")} />
      <GeneralSuggestionCard period={t("period_evening")} title={t("suggestionEveningStroll")} badge={t("badgeGeneral")} />
    </TripDayTimeline>
  );
}

function TripPlanPrototype({ state }: { state: PlanState }) {
  const t = useTranslations("trips");
  const c = useLabCopy();
  const title = t("planTitle", { region: c.region });

  if (state === "loading") {
    return (
      <BrowseShell title={t("pageTitle")}>
        <StateView kind="loading" title={t("generating")} body={t("generatingHint")} />
      </BrowseShell>
    );
  }
  if (state === "rateLimited") {
    return (
      <BrowseShell title={t("pageTitle")}>
        <StateView kind="error" title={t("errorRateLimited")} action={<Button variant="secondary" fullWidth>{t("retry")}</Button>} />
      </BrowseShell>
    );
  }
  if (state === "noServices") {
    return (
      <BrowseShell title={title}>
        <Chips />
        <StateView kind="empty" title={c.noServicesTitle} body={t("planNoServices")} action={<Button fullWidth>{c.otherRegion}</Button>} secondaryAction={<Button variant="tertiary">{c.showGeneral}</Button>} />
      </BrowseShell>
    );
  }
  return (
    <BrowseShell title={title}>
      <Notice tone="info">{t("planDisclaimer")}</Notice>
      {state === "partial" && <Notice tone="warning">{t("planPartial")}</Notice>}
      <Chips />
      <Day n={1} withService />
      <Day n={2} withService={state === "mixed"} />
      <p className="text-[0.9375rem] leading-[1.5] text-foreground/70">{t("travelTimeUnavailable")}</p>
    </BrowseShell>
  );
}

const meta = {
  title: "Prototypes/3 Trip plan",
  component: TripPlanPrototype,
  tags: ["prototype", "text-scale"],
  args: { state: "mixed" },
  argTypes: { state: { control: "inline-radio", options: ["mixed", "partial", "noServices", "loading", "rateLimited"] } },
} satisfies Meta<typeof TripPlanPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = { name: "Plan · services + general ideas", args: { state: "mixed" } };
export const Partial: Story = { name: "Plan · some days without services", args: { state: "partial" } };
export const NoServices: Story = { name: "Empty · no services in region", args: { state: "noServices" } };
export const Loading: Story = { name: "Loading · preparing plan", args: { state: "loading" } };
export const RateLimited: Story = { name: "Error · too many requests", args: { state: "rateLimited" } };
