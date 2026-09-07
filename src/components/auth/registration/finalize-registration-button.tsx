"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { finalizeRegistration } from "@/lib/registration/finalize-registration";
import { isRegistrationErrorCode, getRegistrationErrorTranslationKey } from "@/lib/registration/registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Explicit finish action → atomic
// finalizeRegistration. On success we refresh; the server then resolves the step to DONE
// and redirects to the role landing. Idempotent server-side, so a double click is safe.
type Labels = { finish: string; genericError: string };

export function FinalizeRegistrationButton({ labels, errorLabels }: { labels: Labels; errorLabels: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await finalizeRegistration();
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(
        isRegistrationErrorCode(result.error)
          ? errorLabels[getRegistrationErrorTranslationKey(result.error)] ?? labels.genericError
          : labels.genericError
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={onClick}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {labels.finish}
      </button>
    </div>
  );
}
