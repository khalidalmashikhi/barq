"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { setRegistrationName } from "@/lib/registration/set-registration-name";
import { isRegistrationErrorCode, getRegistrationErrorTranslationKey } from "@/lib/registration/registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Collects the display name, persisted to
// the canonical User.name (survives refresh/multi-device). The server re-derives the
// next step, so on success we refresh.
type Labels = { label: string; placeholder: string; submit: string; genericError: string };

export function RegistrationNameForm({
  labels,
  errorLabels,
  defaultValue,
}: {
  labels: Labels;
  errorLabels: Record<string, string>;
  defaultValue: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(defaultValue);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setRegistrationName(value);
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
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <label htmlFor="registration-name" className="text-sm font-medium text-foreground/70">
        {labels.label}
      </label>
      <input
        id="registration-name"
        name="name"
        type="text"
        required
        minLength={2}
        maxLength={80}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={labels.placeholder}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-base text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <button
        type="submit"
        disabled={pending || value.trim().length < 2}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
