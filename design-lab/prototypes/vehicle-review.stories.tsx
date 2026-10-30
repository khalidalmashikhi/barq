import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { FileText, Lock } from "lucide-react";
import { Button } from "../components/button";
import { Notice } from "../components/notice";
import { RowList, SectionCard } from "../components/section-card";
import { Skeleton, StateView } from "../components/state-view";
import { StatusBadge } from "../components/status-badge";
import { StepProgress } from "../components/step-progress";
import { StickyActionBar, type BarMode } from "../components/sticky-action-bar";
import { SensitiveDataRow, ValueRow } from "../components/value-row";
import { SYNTHETIC, useLabCopy } from "../copy";
import { TEXT } from "../tokens";
import { TaskShell } from "./shell";

// Prototype 2 — vehicle data review & creation (Storybook only; the real screen is unchanged).
// Three section cards (customer-visible · private · document) instead of six cards and a file box
// inside a card; one row per field; private values masked; ONE primary action with what is still
// missing said next to it; "Cancel" lives in the header's back action. After creation the vehicle is
// "under BARQ review" — never "approved". Synthetic data only.

type ReviewState = "needsReview" | "ready" | "saving" | "saveError" | "loading" | "empty" | "created";

function Progress() {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  return (
    <StepProgress
      label={t("vehicleJourneyStepsLabel")}
      steps={[
        { name: t("vehicleJourneyStep1"), status: "done" },
        { name: t("vehicleJourneyStep2"), status: "done" },
        { name: t("vehicleJourneyStep3"), status: "current" },
        { name: t("vehicleJourneyStep4"), status: "upcoming" },
      ]}
      summary={(n, _total, name) => td("vehicleJourneyStepOf", { step: n, name })}
      statusText={{ done: t("vehicleJourneyStepDone") }}
    />
  );
}

function ReviewPrototype({ state, barMode = "A" }: { state: ReviewState; barMode?: BarMode }) {
  const c = useLabCopy();
  const ready = state === "ready" || state === "saving" || state === "saveError";
  const left = ready ? 0 : 3;

  if (state === "loading") {
    return (
      <TaskShell title={c.taskAddVehicle} backLabel={c.back}>
        <Progress />
        <section aria-busy className="flex flex-col gap-3 rounded-[1.25rem] border border-foreground/10 bg-card p-5">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-3 h-4 w-1/3" />
          <Skeleton className="h-6 w-2/3" />
        </section>
      </TaskShell>
    );
  }
  if (state === "empty") {
    return (
      <TaskShell title={c.taskAddVehicle} backLabel={c.back}>
        <Progress />
        <StateView kind="empty" title={c.emptyTitle} body={c.emptyBody} action={<Button fullWidth>{c.startManual}</Button>} />
      </TaskShell>
    );
  }
  if (state === "created") {
    return (
      <TaskShell title={c.taskAddVehicle} backLabel={c.back}>
        <StateView kind="success" title={c.createdTitle} body={c.createdBody} action={<Button fullWidth>{c.viewVehicle}</Button>} />
      </TaskShell>
    );
  }

  const primary = (
    <Button fullWidth disabled={!ready} disabledReason={c.remaining(left)} loading={state === "saving"} loadingLabel={c.creating}>
      {c.create}
    </Button>
  );
  const statusLine = ready ? c.allReady : c.remaining(left);
  // While disabled the reason sits under the button (aria-describedby); when ready the bar says so.
  const bar = <StickyActionBar mode={barMode} status={ready && state !== "saving" ? statusLine : undefined} primary={primary} secondary={<Button variant="tertiary">{c.saveLater}</Button>} />;
  // Large text, mode A: status / reason (visible copy), save-for-later and cancel live in the page.
  const inlineActions =
    barMode === "A" ? (
      <>
        {state !== "saving" && (
          <p aria-hidden={!ready || undefined} role={ready ? "status" : undefined} className="text-[1rem] leading-[1.65] text-foreground/70">
            {statusLine}
          </p>
        )}
        <Button variant="secondary" fullWidth>
          {c.saveLater}
        </Button>
        <Button variant="tertiary">{c.cancel}</Button>
      </>
    ) : undefined;
  const aside = (
    <section className="flex flex-col gap-3 rounded-[1.25rem] border border-foreground/10 bg-card p-5">
      <Notice tone={ready ? "success" : "warning"}>{statusLine}</Notice>
      {primary}
      <div className="flex justify-center">
        <Button variant="tertiary">{c.saveLater}</Button>
      </div>
    </section>
  );

  return (
    <TaskShell title={c.taskAddVehicle} backLabel={c.back} bar={bar} aside={aside} inlineActions={inlineActions}>
      <Progress />
      <h1 className={`${TEXT.title} hidden lg:block`}>{c.reviewTitle}</h1>
      {state === "saveError" && <Notice tone="danger">{c.saveError}</Notice>}
      {!ready && <Notice tone="warning">{c.reviewSummary(9, 3)}</Notice>}
      <SectionCard title={c.customerSection} badge={ready ? <StatusBadge tone="ok">{c.ready}</StatusBadge> : <StatusBadge tone="review">{c.toReview(2)}</StatusBadge>}>
        <RowList>
          <ValueRow label={c.fieldType} value={c.valueType} actionLabel={c.edit} />
          <ValueRow label={c.fieldMakeModel} value={c.valueMakeModel} actionLabel={c.edit} />
          <ValueRow label={c.fieldYear} value={SYNTHETIC.year} valueDir="ltr" state={ready ? "default" : "review"} source={ready ? undefined : c.fromDocument} actionLabel={ready ? c.edit : c.confirm} />
          <ValueRow label={c.fieldSeats} value={ready ? "6" : undefined} valueDir="ltr" placeholder={c.notSet} state={ready ? "default" : "missing"} source={ready ? undefined : c.seatsNotRead} actionLabel={ready ? c.edit : c.enter} />
          <ValueRow label={c.fieldColour} value={c.valueColour} actionLabel={c.edit} />
        </RowList>
      </SectionCard>
      <SectionCard title={c.privateSection} icon={<Lock className="ds-icon" aria-hidden />} badge={ready ? <StatusBadge tone="ok">{c.ready}</StatusBadge> : <StatusBadge tone="review">{c.toReview(1)}</StatusBadge>}>
        <p className="-mt-2 text-[1rem] leading-[1.65] text-foreground/70">{c.privateNote}</p>
        <RowList>
          <SensitiveDataRow label={c.fieldPlate} maskedValue={SYNTHETIC.plateMasked} value={SYNTHETIC.plate} showLabel={c.show} hideLabel={c.hide} state={ready ? "default" : "review"} source={ready ? undefined : c.fromDocument} actionLabel={ready ? undefined : c.confirm} />
          <SensitiveDataRow label={c.fieldVin} maskedValue={SYNTHETIC.vinMasked} value={SYNTHETIC.vin} showLabel={c.show} hideLabel={c.hide} />
          <ValueRow label={c.fieldExpiry} value={SYNTHETIC.expiry} valueDir="ltr" actionLabel={c.edit} />
          <SensitiveDataRow label={c.fieldOwner} maskedValue={SYNTHETIC.ownerMasked} value={SYNTHETIC.owner} showLabel={c.show} hideLabel={c.hide} />
        </RowList>
      </SectionCard>
      <SectionCard title={c.documentSection} icon={<FileText className="ds-icon" aria-hidden />} action={<Button size="sm" variant="tertiary">{c.view}</Button>}>
        <p dir="ltr" className="-mt-2 self-start text-[1rem] text-foreground/70">
          {SYNTHETIC.file}
        </p>
      </SectionCard>
    </TaskShell>
  );
}

const meta = {
  title: "Prototypes/2 Vehicle review",
  component: ReviewPrototype,
  tags: ["prototype", "text-scale"],
  args: { state: "needsReview" },
  argTypes: { state: { control: "inline-radio", options: ["needsReview", "ready", "saving", "saveError", "loading", "empty", "created"] }, barMode: { control: "inline-radio", options: ["A", "B"] } },
} satisfies Meta<typeof ReviewPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsReview: Story = { name: "Needs review · create disabled", args: { state: "needsReview" } };
export const Ready: Story = { args: { state: "ready" } };
export const Saving: Story = { name: "Loading · creating", args: { state: "saving" } };
export const SaveError: Story = { name: "Error · save failed", args: { state: "saveError" } };
export const Loading: Story = { name: "Loading · suggestions", args: { state: "loading" } };
export const Empty: Story = { name: "Empty · nothing read", args: { state: "empty" } };
export const Created: Story = { name: "Success · created", args: { state: "created" } };

// Large-text bar options, compared at 200 % (owner correction 2026-10-26). A is the chosen default.
export const LargeTextOptionA: Story = { name: "Large text 200 % · option A (primary sticky)", args: { state: "needsReview", barMode: "A" }, globals: { textScale: "200" } };
export const LargeTextOptionB: Story = { name: "Large text 200 % · option B (no sticky bar)", args: { state: "needsReview", barMode: "B" }, globals: { textScale: "200" } };
