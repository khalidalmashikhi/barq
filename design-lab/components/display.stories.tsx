import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { Lock, ShieldCheck } from "lucide-react";
import { Canvas, Specimen } from "../canvas";
import { SYNTHETIC, useLabCopy } from "../copy";
import { Accordion } from "./accordion";
import { Button } from "./button";
import { Notice } from "./notice";
import { RowList, SectionCard } from "./section-card";
import { StatusBadge } from "./status-badge";
import { StepProgress } from "./step-progress";
import { StickyActionBar } from "./sticky-action-bar";
import { SensitiveDataRow, ValueRow } from "./value-row";

// Display components: Section Card, Status Badge, Alert, Accordion, Step Progress, Sticky Action Bar,
// Sensitive Data Row (and the plain ValueRow it pairs with).

const meta = { title: "Components/Display", tags: ["text-scale"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SectionCards: Story = {
  name: "Section Card",
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <SectionCard title={c.customerSection} badge={<StatusBadge tone="review">{c.toReview(2)}</StatusBadge>}>
          <RowList>
            <ValueRow label={c.fieldType} value={c.valueType} actionLabel={c.edit} />
            <ValueRow label={c.fieldYear} value={SYNTHETIC.year} valueDir="ltr" state="review" source={c.fromDocument} actionLabel={c.confirm} />
            <ValueRow label={c.fieldSeats} placeholder={c.notSet} state="missing" source={c.seatsNotRead} actionLabel={c.enter} />
          </RowList>
        </SectionCard>
      </Canvas>
    );
  },
};

export const StatusBadges: Story = {
  name: "Status Badge",
  render: function Render() {
    const c = useLabCopy();
    const t = useTranslations("trips");
    return (
      <Canvas>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="review">{c.toReview(3)}</StatusBadge>
          <StatusBadge tone="ok">{c.ready}</StatusBadge>
          <StatusBadge tone="missing">{c.notSet}</StatusBadge>
          <StatusBadge tone="private">{c.privateSection}</StatusBadge>
          <StatusBadge tone="neutral">{t("badgeGeneral")}</StatusBadge>
          <StatusBadge tone="teal">{t("badgeCheckOnBooking")}</StatusBadge>
          <StatusBadge tone="ok">{t("badgeBookable")}</StatusBadge>
        </div>
      </Canvas>
    );
  },
};

export const Alerts: Story = {
  name: "Alert",
  render: function Render() {
    const c = useLabCopy();
    const t = useTranslations("trips");
    return (
      <Canvas>
        <Notice tone="info">{t("planDisclaimer")}</Notice>
        <Notice tone="warning">{c.reviewSummary(9, 3)}</Notice>
        <Notice tone="danger" action={<Button size="sm" variant="secondary">{c.retry}</Button>}>
          {c.saveError}
        </Notice>
        <Notice tone="success">{c.createdBody}</Notice>
      </Canvas>
    );
  },
};

export const AccordionStory: Story = {
  name: "Accordion",
  tags: ["states"],
  render: function Render() {
    const t = useTranslations("provider");
    return (
      <Canvas>
        <Specimen label="closed">
          <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />}>
            <p>{t("vehicleRegConsentDetailsExternal")}</p>
          </Accordion>
        </Specimen>
        <Specimen label="hover · focus · pressed">
          <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />} forceState="hover">
            <p>{t("vehicleRegConsentDetailsExternal")}</p>
          </Accordion>
          <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />} forceState="focus">
            <p>{t("vehicleRegConsentDetailsExternal")}</p>
          </Accordion>
          <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />} forceState="pressed">
            <p>{t("vehicleRegConsentDetailsExternal")}</p>
          </Accordion>
        </Specimen>
        <Specimen label="open">
          <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />} defaultOpen>
            <p>{t("vehicleRegConsentDetailsExternal")}</p>
            <p>{t("vehicleRegConsentLimits")}</p>
            <p>{t("vehicleRegConsentLegalNote")}</p>
          </Accordion>
        </Specimen>
      </Canvas>
    );
  },
};

function JourneyProgress({ step, error = false }: { step: 1 | 2 | 3 | 4; error?: boolean }) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const names = [t("vehicleJourneyStep1"), t("vehicleJourneyStep2"), t("vehicleJourneyStep3"), t("vehicleJourneyStep4")];
  return (
    <StepProgress
      label={t("vehicleJourneyStepsLabel")}
      steps={names.map((name, i) => ({ name, status: i + 1 < step ? "done" : i + 1 === step ? (error ? "error" : "current") : "upcoming" }))}
      summary={(n, _total, name) => td("vehicleJourneyStepOf", { step: n, name })}
      statusText={{ done: t("vehicleJourneyStepDone"), error: t("vehicleJourneyStepFailed") }}
    />
  );
}

export const StepProgressStory: Story = {
  name: "Step Progress",
  render: () => (
    <Canvas>
      <Specimen label="step 2 current">
        <JourneyProgress step={2} />
      </Specimen>
      <Specimen label="step 2 reading failed">
        <JourneyProgress step={2} error />
      </Specimen>
      <Specimen label="step 3 current">
        <JourneyProgress step={3} />
      </Specimen>
    </Canvas>
  ),
};

export const StickyActionBarStory: Story = {
  name: "Sticky Action Bar",
  render: function Render() {
    const c = useLabCopy();
    return (
      <main className="flex min-h-screen flex-col justify-end bg-background">
        <StickyActionBar
          status={c.remaining(3)}
          primary={
            <Button fullWidth disabled>
              {c.create}
            </Button>
          }
          secondary={<Button variant="tertiary">{c.saveLater}</Button>}
        />
        <StickyActionBar status={c.allReady} primary={<Button fullWidth>{c.create}</Button>} />
        <StickyActionBar
          primary={
            <Button fullWidth loading loadingLabel={c.creating}>
              {c.create}
            </Button>
          }
        />
      </main>
    );
  },
};

export const SensitiveDataRowStory: Story = {
  name: "Sensitive Data Row",
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <SectionCard title={c.privateSection} icon={<Lock className="ds-icon" aria-hidden />} badge={<StatusBadge tone="review">{c.toReview(1)}</StatusBadge>}>
          <p className="-mt-2 text-[1rem] leading-[1.65] text-foreground/70">{c.privateNote}</p>
          <RowList>
            <SensitiveDataRow label={c.fieldPlate} maskedValue={SYNTHETIC.plateMasked} value={SYNTHETIC.plate} showLabel={c.show} hideLabel={c.hide} state="review" source={c.fromDocument} actionLabel={c.confirm} />
            <SensitiveDataRow label={c.fieldVin} maskedValue={SYNTHETIC.vinMasked} value={SYNTHETIC.vin} showLabel={c.show} hideLabel={c.hide} />
            <SensitiveDataRow label={c.fieldOwner} maskedValue={SYNTHETIC.ownerMasked} value={SYNTHETIC.owner} showLabel={c.show} hideLabel={c.hide} />
          </RowList>
        </SectionCard>
      </Canvas>
    );
  },
};
