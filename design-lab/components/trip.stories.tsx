import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { Canvas } from "../canvas";
import { useLabCopy } from "../copy";
import { BarqServiceCard, GeneralSuggestionCard, TripDayTimeline } from "./trip";

const meta = { title: "Components/Trip", tags: ["text-scale"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TripDayTimelineStory: Story = {
  name: "Trip Day Timeline",
  render: function Render() {
    const t = useTranslations("trips");
    const c = useLabCopy();
    return (
      <Canvas>
        <TripDayTimeline title={t("dayTitle", { number: 1 })} regenerateLabel={t("regenerateDay")} footer={t("dayCost", { range: c.range1 })}>
          <BarqServiceCard period={t("period_morning")} title={c.serviceSynthetic} badge={t("badgeCheckOnBooking")} cost={t("estimatedCost", { range: c.range1 })} duration={t("durationLabel", { duration: c.hours4 })} viewLabel={c.view} replaceLabel={t("replace")} />
          <GeneralSuggestionCard period={t("period_afternoon")} title={t("suggestionFreeTime")} badge={t("badgeGeneral")} />
          <GeneralSuggestionCard period={t("period_evening")} title={t("suggestionEveningStroll")} badge={t("badgeGeneral")} />
        </TripDayTimeline>
      </Canvas>
    );
  },
};

export const BarqServiceCardStory: Story = {
  name: "BARQ Service Card",
  render: function Render() {
    const t = useTranslations("trips");
    const c = useLabCopy();
    return (
      <Canvas>
        <ol className="rounded-[1.25rem] border border-foreground/10 bg-card px-5">
          <BarqServiceCard period={t("period_morning")} title={c.serviceSynthetic} badge={t("badgeCheckOnBooking")} cost={t("estimatedCost", { range: c.range1 })} duration={t("durationLabel", { duration: c.hours4 })} viewLabel={c.view} replaceLabel={t("replace")} />
        </ol>
        <ol className="rounded-[1.25rem] border border-foreground/10 bg-card px-5">
          <BarqServiceCard period={t("period_afternoon")} title={c.serviceSynthetic2} badge={t("badgeBookable")} badgeTone="ok" cost={t("estimatedCost", { range: c.range2 })} duration={t("durationLabel", { duration: c.hours2 })} viewLabel={c.view} />
        </ol>
      </Canvas>
    );
  },
};

export const GeneralSuggestionCardStory: Story = {
  name: "General Suggestion Card",
  render: function Render() {
    const t = useTranslations("trips");
    return (
      <Canvas>
        <ol className="rounded-[1.25rem] border border-foreground/10 bg-card px-5">
          <GeneralSuggestionCard period={t("period_afternoon")} title={t("suggestionFreeTime")} badge={t("badgeGeneral")} note={t("generalNote")} />
        </ol>
      </Canvas>
    );
  },
};
