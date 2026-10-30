import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { PencilLine, ScanLine, ShieldCheck } from "lucide-react";
import { Accordion } from "../components/accordion";
import { Button } from "../components/button";
import { ConfirmCheck } from "../components/confirm-check";
import { Notice } from "../components/notice";
import { StateView } from "../components/state-view";
import { StepProgress } from "../components/step-progress";
import { StickyActionBar, type BarMode } from "../components/sticky-action-bar";
import { useLabCopy } from "../copy";
import { FOCUS_RING, TEXT } from "../tokens";
import { TaskShell } from "./shell";

// Prototype 1 — vehicle-document reading consent (Storybook only; the real step is
// src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx, unchanged).
//
// Every string that carries the notice's MEANING is read verbatim from messages/* — the keys pinned by
// consent-notice-invariance.test.ts (disclosure, privacy details, limits, legal note, owner attestation,
// policy link, declined notice). Only the title and the button labels are proposed copy. The three
// "trust" bullets are dropped because they repeat the disclosure sentence.

type ConsentState = "choose" | "confirmed" | "reading" | "error" | "declined";

function Progress({ failed = false }: { failed?: boolean }) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  return (
    <StepProgress
      label={t("vehicleJourneyStepsLabel")}
      steps={[
        { name: t("vehicleJourneyStep1"), status: "done" },
        { name: t("vehicleJourneyStep2"), status: failed ? "error" : "current" },
        { name: t("vehicleJourneyStep3"), status: "upcoming" },
        { name: t("vehicleJourneyStep4"), status: "upcoming" },
      ]}
      summary={(n, _total, name) => td("vehicleJourneyStepOf", { step: n, name })}
      statusText={{ done: t("vehicleJourneyStepDone"), error: t("vehicleJourneyStepFailed") }}
    />
  );
}

function ConsentPrototype({ state, barMode = "A" }: { state: ConsentState; barMode?: BarMode }) {
  const t = useTranslations("provider");
  const c = useLabCopy();
  const [authorized, setAuthorized] = useState(state !== "choose");
  const [detailsOpen] = useState(state === "confirmed");

  if (state === "reading") {
    return (
      <TaskShell title={c.taskAddVehicle} backLabel={c.back}>
        <Progress />
        <StateView kind="loading" title={c.consentReading} body={`${t("vehicleOnboardSetSummaryImage")} · ${c.consentReadingBody}`} />
      </TaskShell>
    );
  }

  if (state === "declined") {
    return (
      <TaskShell title={c.taskAddVehicle} backLabel={c.back}>
        <Progress />
        <section className="flex flex-col gap-3 rounded-[1.25rem] border border-foreground/10 bg-card p-5">
          <p className={TEXT.support}>{t("vehicleRegConsentDeclinedNotice")}</p>
          <Button variant="secondary" fullWidth icon={<ScanLine className="ds-icon-sm" aria-hidden />}>
            {t("vehicleRegConsentChangeMind")}
          </Button>
        </section>
      </TaskShell>
    );
  }

  const bar = (
    <StickyActionBar
      mode={barMode}
      primary={
        <Button fullWidth disabled={!authorized} disabledReason={t("vehicleJourneyConsentNeedsAuthorization")} icon={<ScanLine className="ds-icon" aria-hidden />}>
          {state === "error" ? c.retry : c.consentRead}
        </Button>
      }
      secondary={
        <Button variant="tertiary" icon={<PencilLine className="ds-icon-sm" aria-hidden />}>
          {t("vehicleRegConsentManualButton")}
        </Button>
      }
    />
  );

  // Large text, mode A: the page's action area holds the disabled reason (visible copy; the bar's copy
  // stays announced through aria-describedby) and the secondary action.
  const inlineActions =
    barMode === "A" ? (
      <>
        {!authorized && (
          <p aria-hidden className={TEXT.support}>
            {t("vehicleJourneyConsentNeedsAuthorization")}
          </p>
        )}
        <Button variant="secondary" fullWidth icon={<PencilLine className="ds-icon-sm" aria-hidden />}>
          {t("vehicleRegConsentManualButton")}
        </Button>
      </>
    ) : undefined;

  return (
    <TaskShell title={c.taskAddVehicle} backLabel={c.back} bar={bar} inlineActions={inlineActions} aside={<div className="rounded-[1.25rem] border border-foreground/10 bg-card p-4">{bar}</div>}>
      <Progress failed={state === "error"} />
      {state === "error" && <Notice tone="danger">{c.consentErrorBody}</Notice>}
      <section aria-labelledby="consent-title" className="flex flex-col gap-4 rounded-[1.25rem] border border-foreground/10 bg-card p-5">
        <h1 id="consent-title" className="text-[1.375rem] font-semibold leading-[1.45] text-foreground">
          {c.consentTitle}
        </h1>
        <p className={TEXT.body}>{t("vehicleRegConsentDisclosure")}</p>
        <Accordion summary={t("vehicleRegConsentDetailsToggle")} icon={<ShieldCheck className="ds-icon" aria-hidden />} defaultOpen={detailsOpen} className="-mx-5 px-4">
          <p>{t("vehicleRegConsentDetailsExternal")}</p>
          <p>{t("vehicleRegConsentLimits")}</p>
          <p>{t("vehicleRegConsentLegalNote")}</p>
        </Accordion>
        <a href="#privacy-automatic-reading" className={`inline-flex min-h-11 items-center self-start rounded text-[1rem] font-semibold text-primary underline underline-offset-4 ${FOCUS_RING}`}>
          {t("vehicleRegConsentPrivacyPolicyLink")}
        </a>
        <ConfirmCheck checked={authorized} onChange={setAuthorized}>
          {t("vehicleRegConsentOwnerLabel")}
        </ConfirmCheck>
      </section>
    </TaskShell>
  );
}

const meta = {
  title: "Prototypes/1 Vehicle reading consent",
  component: ConsentPrototype,
  tags: ["prototype", "text-scale"],
  args: { state: "choose" },
  argTypes: { state: { control: "inline-radio", options: ["choose", "confirmed", "reading", "error", "declined"] }, barMode: { control: "inline-radio", options: ["A", "B"] } },
} satisfies Meta<typeof ConsentPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Choose: Story = { args: { state: "choose" } };
export const ConfirmedDetailsOpen: Story = { name: "Confirmed · details open", args: { state: "confirmed" } };
export const Reading: Story = { name: "Loading · reading", args: { state: "reading" } };
export const ReadingFailed: Story = { name: "Error · reading failed", args: { state: "error" } };
export const Declined: Story = { name: "Declined (compact)", args: { state: "declined" } };

// Large-text bar options, compared at 200 % (owner correction 2026-10-26). A is the chosen default.
export const LargeTextOptionA: Story = { name: "Large text 200 % · option A (primary sticky)", args: { state: "choose", barMode: "A" }, globals: { textScale: "200" } };
export const LargeTextOptionB: Story = { name: "Large text 200 % · option B (no sticky bar)", args: { state: "choose", barMode: "B" }, globals: { textScale: "200" } };
