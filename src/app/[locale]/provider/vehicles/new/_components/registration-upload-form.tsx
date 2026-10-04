"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileUp, Lock } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { prepareFileForUpload } from "@/lib/vehicles/documents/client-upload-file";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";

// Phase 3C Slice 3B — the registration-document upload step (client island). This is the FIRST and
// ONLY thing a provider sees when adding a vehicle: no make/model/capacity field exists before a
// document is uploaded. Two ways to supply it: the device camera, or the photo/file picker.
//
// The upload goes by fetch so the provider sees what is happening (preparing the photo → uploading),
// errors stay on screen next to the button, and a failed attempt can simply be retried.
//
// REPEATED INTERACTION: a synchronous guard stops a double tap here, but correctness does NOT depend
// on it. Every attempt from this mounted form carries the same random `requestKey`, and the SERVER
// makes that key unique per provider — so a double tap, or a retry after a dropped connection,
// can only ever produce one vehicle setup.
//
// Without JavaScript the same <form> still posts natively (multipart → 303), using the key the
// server rendered into it.

type Props = {
  /** Server route that receives the multipart POST. */
  action: string;
  locale: string;
  /** Idempotency key issued by the server with this form (start flow only). */
  requestKey?: string;
  /** Extra fields (e.g. the document type when attaching to an existing unfinished setup). */
  hiddenFields?: Record<string, string>;
  /** Where to go when the server reports success without its own destination. */
  successHref?: string;
  /** Where the safe cancel/back control leads. */
  cancelHref: string;
};

const ACCEPT_FILE = "application/pdf,image/jpeg,image/png";
const ACCEPT_CAMERA = "image/jpeg,image/png";
const CHOICE_CLASS =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/40";

type Phase = "idle" | "processing" | "uploading" | "done";

function newRequestKey(fallback: string | undefined): string | undefined {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallback;
}

export function RegistrationUploadForm({ action, locale, requestKey, hiddenFields, successHref, cancelHref }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // error keys resolved from a server code (parity-guaranteed)
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  // One key per mounted form: reused by every attempt from it, fresh for a new mount / restored page.
  const keyRef = useRef<string | undefined>(requestKey);
  const [source, setSource] = useState<"camera" | "file" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (requestKey) keyRef.current = newRequestKey(requestKey);
    // A page restored from the back/forward cache is a NEW attempt: fresh key, nothing "in flight".
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busyRef.current = false;
      setPhase("idle");
      if (requestKey) keyRef.current = newRequestKey(requestKey);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [requestKey]);

  useEffect(() => {
    if (errorKey) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [errorKey]);

  const busy = phase !== "idle";

  const pick = (which: "camera" | "file") => (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    if (!chosen) return;
    const other = which === "camera" ? fileRef.current : cameraRef.current;
    if (other) other.value = ""; // only one document at a time
    setSource(which);
    setFile(chosen);
    setErrorKey(null);
  };

  const fail = (code: string) => {
    busyRef.current = false; // a retry is allowed — and safe: it carries the same request key
    setPhase("idle");
    setErrorKey(isAssetDocumentErrorCode(code) ? getAssetDocumentErrorTranslationKey(code) : code === "NETWORK" ? "vehicleOnboardErrNetwork" : "vehicleOnboardUploadFailed");
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setErrorKey(null);

    setPhase("processing");
    const prepared = await prepareFileForUpload(file);
    if (!prepared.ok) return fail(prepared.error);

    setPhase("uploading");
    const body = new FormData();
    body.set("locale", locale);
    if (keyRef.current) body.set("requestKey", keyRef.current);
    for (const [name, value] of Object.entries(hiddenFields ?? {})) body.set(name, value);
    body.set("file", prepared.blob, prepared.filename);

    let response: Response;
    try {
      response = await fetch(action, { method: "POST", body, headers: { accept: "application/json" }, credentials: "same-origin" });
    } catch {
      return fail("NETWORK"); // connection dropped — nothing is lost; the same key makes a retry safe
    }

    let payload: { ok?: boolean; error?: string; redirectTo?: string } | null = null;
    try {
      payload = await response.json();
    } catch {
      /* a non-JSON answer (e.g. the platform refusing an oversized body) */
    }
    if (payload?.ok) {
      setPhase("done");
      router.push(payload.redirectTo ?? successHref ?? cancelHref);
      router.refresh();
      return;
    }
    if (payload?.error === "UNAUTHENTICATED" || response.status === 401) {
      router.push("/login");
      return;
    }
    fail(payload?.error ?? (response.status === 413 ? "TOO_LARGE" : "UNKNOWN_ERROR"));
  };

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={onSubmit} aria-busy={busy} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {requestKey && <input type="hidden" name="requestKey" value={requestKey} />}
      {hiddenFields && Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-accent/10 p-4">
        <p className="text-sm font-medium text-foreground">{t("vehicleOnboardFileLabel")}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className={`${CHOICE_CLASS} ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <Camera size={18} strokeWidth={1.75} aria-hidden />
            {t("vehicleOnboardTakePhoto")}
            <input ref={cameraRef} type="file" accept={ACCEPT_CAMERA} capture="environment" name={source === "camera" ? "file" : undefined} onChange={pick("camera")} className="sr-only" />
          </label>
          <label className={`${CHOICE_CLASS} ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <FileUp size={18} strokeWidth={1.75} aria-hidden />
            {t("vehicleOnboardChooseFile")}
            <input ref={fileRef} type="file" accept={ACCEPT_FILE} name={source === "camera" ? undefined : "file"} onChange={pick("file")} className="sr-only" />
          </label>
        </div>
        <p className="break-words text-sm text-foreground/80" aria-live="polite">
          {file ? (
            <>
              <span className="text-foreground/60">{t("vehicleOnboardSelectedFileLabel")}: </span>
              <bdi>{file.name}</bdi>
            </>
          ) : (
            <span className="text-foreground/50">{t("vehicleOnboardNoFileSelected")}</span>
          )}
        </p>
        <p className="text-xs text-foreground/60">{t("vehicleOnboardFileHint")}</p>
      </div>

      <p className="flex items-start gap-2 text-xs text-foreground/70">
        <Lock size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        <span>{t("vehicleOnboardPrivacyNote")}</span>
      </p>

      {/* The danger Alert is itself role="alert" (announced once); this wrapper only anchors the scroll. */}
      <div ref={errorRef} className="scroll-mb-40 scroll-mt-24">
        {errorKey && <Alert variant="danger">{td(errorKey)}</Alert>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!file || busy}
          className="inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          {phase === "processing" ? t("vehicleOnboardProcessingImage") : phase === "uploading" || phase === "done" ? t("vehicleOnboardUploading") : t("vehicleOnboardUploadButton")}
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
