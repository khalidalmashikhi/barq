"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { RentalOfferingStatus } from "@prisma/client";
import { Dialog } from "@/components/ui/dialog";
import { clsx } from "@/components/ui/clsx";
import { useRouter } from "@/i18n/navigation";
import { rentalActionMessageKey } from "@/lib/offerings/rental/provider/rental-action-result";
import { publishRentalOfferingAction, suspendRentalOfferingAction, archiveRentalOfferingAction } from "../actions";

// Phase 3C Slice C2d-R1 Checkpoint B — lifecycle controls. Only the transitions VALID for the current
// status are offered; each is confirmed in an accessible Dialog before running. Every transition calls
// the authoritative C2b-R mutation — the UI NEVER re-checks compliance / vehicle readiness / open-day
// / ownership; when publish is blocked, the domain's provider-safe code is mapped to a localized
// message shown here (never internal document/policy detail). Success refreshes the detail + the list/
// overview metrics. Archived offerings expose no controls.

type Transition = "publish" | "suspend" | "archive";
type Status = { kind: "idle" } | { kind: "error"; code: string };

const TRANSITIONS: Record<RentalOfferingStatus, Transition[]> = {
  DRAFT: ["publish", "archive"],
  PUBLISHED: ["suspend", "archive"],
  SUSPENDED: ["publish", "archive"],
  ARCHIVED: [],
};

export function OfferingLifecyclePanel({ offeringId, status }: { offeringId: string; status: RentalOfferingStatus }) {
  const t = useTranslations("provider");
  const tt = t as unknown as (key: string) => string;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Transition | null>(null);
  const [result, setResult] = useState<Status>({ kind: "idle" });

  const transitions = TRANSITIONS[status];

  function run(transition: Transition) {
    startTransition(async () => {
      const res =
        transition === "publish" ? await publishRentalOfferingAction(offeringId)
        : transition === "suspend" ? await suspendRentalOfferingAction(offeringId)
        : await archiveRentalOfferingAction(offeringId);
      setPending(null);
      if (res.ok) {
        setResult({ kind: "idle" });
        router.refresh();
      } else {
        setResult({ kind: "error", code: res.code });
      }
    });
  }

  const label: Record<Transition, string> = { publish: t("rentalPublish"), suspend: t("rentalSuspend"), archive: t("rentalArchive") };
  const confirmBody: Record<Transition, string> = { publish: t("rentalConfirmPublish"), suspend: t("rentalConfirmSuspend"), archive: t("rentalConfirmArchive") };

  return (
    <section aria-labelledby="rental-lifecycle-heading" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 id="rental-lifecycle-heading" className="text-sm font-medium text-foreground/80">{t("rentalLifecycleHeading")}</h2>

      {status === "ARCHIVED" ? (
        <p className="text-sm text-foreground/60">{t("rentalArchivedReadOnly")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <button key={transition} type="button" onClick={() => { setResult({ kind: "idle" }); setPending(transition); }} disabled={isPending}
              className={clsx("inline-flex min-h-11 items-center rounded-full px-5 py-2 text-sm font-medium transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2",
                transition === "archive" || transition === "suspend"
                  ? "border border-danger/40 text-danger focus-visible:ring-danger/40"
                  : "bg-primary text-primary-foreground focus-visible:ring-primary/40")}>
              {label[transition]}
            </button>
          ))}
        </div>
      )}

      {result.kind === "error" && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{tt(rentalActionMessageKey(result.code as never))}</p>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => { if (!isPending) setPending(null); }}
        title={pending ? label[pending] : ""}
        description={pending ? confirmBody[pending] : ""}
      >
        <div className="flex flex-col gap-4">
          {result.kind === "error" && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{tt(rentalActionMessageKey(result.code as never))}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} disabled={isPending}
              className="min-h-11 rounded-full border border-border px-5 py-2 text-sm text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("rentalCancel")}
            </button>
            <button type="button" onClick={() => pending && run(pending)} disabled={isPending}
              className={clsx("min-h-11 rounded-full px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2",
                pending === "archive" || pending === "suspend" ? "bg-danger focus-visible:ring-danger/40" : "bg-primary focus-visible:ring-primary/40")}>
              {t("rentalConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
