import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VehicleJourneySteps } from "@/components/provider/vehicle-journey/journey-steps";
import { ReadingStatusPanel } from "@/components/provider/vehicle-journey/reading-status-panel";
import { JOURNEY_CARD, JOURNEY_PRIMARY, JOURNEY_SECONDARY } from "@/components/provider/vehicle-journey/journey-ui";
import { Canvas, Specimen } from "../canvas";

// BEFORE — the components the app renders TODAY, imported unchanged (read-only), so each proposal can be
// compared with the real thing in the same Storybook. Nothing here is modified.

const meta = { title: "Current app (before)/Components", tags: ["text-scale"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const JourneyStepsCurrent: Story = {
  name: "Journey steps (current)",
  render: () => (
    <Canvas>
      <Specimen label="read step">
        <VehicleJourneySteps progress={{ stage: "read" }} />
      </Specimen>
      <Specimen label="review step">
        <VehicleJourneySteps progress={{ stage: "review", reading: "succeeded" }} />
      </Specimen>
      <Specimen label="reading failed">
        <VehicleJourneySteps progress={{ stage: "read", failed: true }} />
      </Specimen>
    </Canvas>
  ),
};

export const JourneyButtonsCurrent: Story = {
  name: "Journey buttons + card (current)",
  render: function Render() {
    const t = useTranslations("provider");
    return (
      <Canvas>
        <div className={JOURNEY_CARD}>
          <div className="flex flex-col gap-2">
            <button type="button" className={`${JOURNEY_PRIMARY} w-full`}>
              <ScanLine size={20} aria-hidden />
              {t("vehicleRegConsentReadButton")}
            </button>
            <button type="button" disabled className={`${JOURNEY_PRIMARY} w-full`}>
              {t("vehicleRegConsentReadButton")}
            </button>
            <button type="button" className={`${JOURNEY_SECONDARY} w-full`}>
              {t("vehicleRegConsentManualButton")}
            </button>
          </div>
        </div>
      </Canvas>
    );
  },
};

export const ReadingPanelCurrent: Story = {
  name: "Reading panel (current)",
  render: function Render() {
    const t = useTranslations("provider");
    return (
      <Canvas>
        <div className={JOURNEY_CARD}>
          <ReadingStatusPanel summary={t("vehicleOnboardSetSummaryImage")} />
        </div>
      </Canvas>
    );
  },
};

export const UiPrimitivesCurrent: Story = {
  name: "ui/* primitives (current)",
  render: function Render() {
    const t = useTranslations("trips");
    return (
      <Canvas>
        <Specimen label="ui/button">
          <div className="flex flex-wrap gap-2">
            <Button>{t("createPlan")}</Button>
            <Button variant="ghost">{t("back")}</Button>
            <Button disabled>{t("createPlan")}</Button>
          </div>
        </Specimen>
        <Specimen label="ui/badge">
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">{t("badgeCheckOnBooking")}</Badge>
            <Badge variant="default">{t("badgeGeneral")}</Badge>
            <Badge variant="success">{t("badgeBookable")}</Badge>
          </div>
        </Specimen>
        <Specimen label="ui/alert">
          <Alert variant="warning">{t("planNoServices")}</Alert>
          <Alert variant="info">{t("planDisclaimer")}</Alert>
        </Specimen>
      </Canvas>
    );
  },
};
