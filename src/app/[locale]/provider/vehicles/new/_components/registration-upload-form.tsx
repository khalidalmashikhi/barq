"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileUp, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { MAX_DOCUMENT_BYTES } from "@/lib/provider/documents/document-constants";

// Phase 3C Slice 3B — the registration-document upload step (client island). This is the FIRST and
// ONLY thing a provider sees when adding a vehicle: no make/model/capacity field exists before a
// document is uploaded. It offers two ways to supply the document — the device camera (on mobile
// browsers that support `capture`) or the file browser — and posts a plain multipart form to a
// server route (identity is derived from the session there; nothing here is trusted).
//
// Exactly ONE of the two inputs carries the form field name at a time, so the browser submits a
// single `file` part. A synchronous ref guard makes a double-tap submit once (no duplicate shell).
// The inputs are never `disabled` while submitting: a disabled input is omitted from the request, and
// React applies that state during the submit event — the pickers are made non-interactive instead.

type Props = {
  /** Server route that receives the multipart POST. */
  action: string;
  locale: string;
  /** Extra hidden fields (e.g. the document type when re-uploading for an existing shell). */
  hiddenFields?: Record<string, string>;
  /** Where the safe cancel/back control leads. */
  cancelHref: string;
};

const ACCEPT_FILE = "application/pdf,image/jpeg,image/png";
const ACCEPT_CAMERA = "image/jpeg,image/png";
const CHOICE_CLASS =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/40";

export function RegistrationUploadForm({ action, locale, hiddenFields, cancelHref }: Props) {
  const t = useTranslations("provider");
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const [source, setSource] = useState<"camera" | "file" | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Returning to this page via the browser's back/forward cache must not leave it stuck "uploading".
  useEffect(() => {
    const reset = () => {
      submittedRef.current = false;
      setSubmitting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const pick = (which: "camera" | "file") => (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    if (!chosen) return;
    const other = which === "camera" ? fileRef.current : cameraRef.current;
    if (other) other.value = ""; // only one document at a time
    setSource(which);
    setFileName(chosen.name);
    setTooLarge(chosen.size > MAX_DOCUMENT_BYTES);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!source || tooLarge || submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
    setSubmitting(true);
  };

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {hiddenFields && Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-accent/10 p-4">
        <p className="text-sm font-medium text-foreground">{t("vehicleOnboardFileLabel")}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className={`${CHOICE_CLASS} ${submitting ? "pointer-events-none opacity-60" : ""}`}>
            <Camera size={18} strokeWidth={1.75} aria-hidden />
            {t("vehicleOnboardTakePhoto")}
            <input ref={cameraRef} type="file" accept={ACCEPT_CAMERA} capture="environment" name={source === "camera" ? "file" : undefined} onChange={pick("camera")} className="sr-only" />
          </label>
          <label className={`${CHOICE_CLASS} ${submitting ? "pointer-events-none opacity-60" : ""}`}>
            <FileUp size={18} strokeWidth={1.75} aria-hidden />
            {t("vehicleOnboardChooseFile")}
            <input ref={fileRef} type="file" accept={ACCEPT_FILE} name={source === "camera" ? undefined : "file"} onChange={pick("file")} className="sr-only" />
          </label>
        </div>
        <p className="break-words text-sm text-foreground/80" aria-live="polite">
          {fileName ? (
            <>
              <span className="text-foreground/60">{t("vehicleOnboardSelectedFileLabel")}: </span>
              <span dir="ltr">{fileName}</span>
            </>
          ) : (
            <span className="text-foreground/50">{t("vehicleOnboardNoFileSelected")}</span>
          )}
        </p>
        {tooLarge && <p className="text-sm text-danger">{t("vehicleDocErrorTooLarge")}</p>}
        <p className="text-xs text-foreground/60">{t("vehicleOnboardFileHint")}</p>
      </div>

      <p className="flex items-start gap-2 text-xs text-foreground/70">
        <Lock size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        <span>{t("vehicleOnboardPrivacyNote")}</span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!source || tooLarge || submitting}
          className="inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          {submitting ? t("vehicleOnboardUploading") : t("vehicleOnboardUploadButton")}
        </button>
        <Link
          href={cancelHref}
          className="inline-flex min-h-12 items-center rounded-full border border-border px-6 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {t("vehicleCancelLabel")}
        </Link>
      </div>
    </form>
  );
}
