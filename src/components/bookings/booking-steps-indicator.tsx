import { Check } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { clsx } from "@/components/ui/clsx";

// Booking steps indicator — Phase F.2 (goal 4, Booking Flow progress
// indication). Purely presentational: the booking journey is Detail →
// Book → Confirmation across three real, already-existing pages — this
// just visualizes where the customer is, it does not introduce a new
// multi-step form or any new server action.

type BookingStepsIndicatorProps = {
  currentStep: 2 | 3;
};

export async function BookingStepsIndicator({ currentStep }: BookingStepsIndicatorProps) {
  const t = await getServerTranslator("booking");
  const steps = [
    { step: 1, label: t("stepExperienceLabel") },
    { step: 2, label: t("stepBookLabel") },
    { step: 3, label: t("stepConfirmationLabel") },
  ];

  return (
    <ol className="flex items-center gap-2">
      {steps.map(({ step, label }, index) => {
        const isDone = step < currentStep;
        const isActive = step === currentStep;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={clsx(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                isDone ? "bg-primary text-primary-foreground" : isActive ? "bg-primary/15 text-primary ring-2 ring-primary/30" : "bg-accent/15 text-foreground/40"
              )}
            >
              {isDone ? <Check size={13} strokeWidth={2.5} /> : step}
            </span>
            <span className={clsx("text-xs font-medium", isActive ? "text-foreground" : "text-foreground/40")}>{label}</span>
            {index < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
