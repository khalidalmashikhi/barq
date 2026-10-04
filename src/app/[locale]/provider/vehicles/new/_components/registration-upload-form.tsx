"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileUp, Lock } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { prepareFileForUpload } from "@/lib/vehicles/documents/client-upload-file";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { isOnboardingRequestErrorCode, getOnboardingRequestErrorTranslationKey } from "@/lib/vehicles/onboarding/onboarding-request-errors";
import {
  resolveOnboardingRequestKey,
  rotateOnboardingRequestKey,
  markOnboardingKeyAttempted,
  clearOnboardingRequestKey,
  generateOnboardingRequestKey,
  safeSessionStorage,
} from "@/lib/vehicles/onboarding/onboarding-request-key-store";
import { cancelOnboardingRequestAction } from "../upload-actions";

// Phase 3C Slice 3B — the registration-document upload step (client island). This is the FIRST and
// ONLY thing a provider sees when adding a vehicle: no make/model/capacity field exists before a
// document is uploaded. Two ways to supply it: the device camera, or the photo/file picker.
//
// The upload goes by fetch so the provider sees what is happening (preparing the photo → uploading),
// errors stay on screen next to the button, and a failed attempt can simply be retried.
//
// ONE STABLE REQUEST KEY PER ATTEMPT. The server makes a request key idempotent (a durable request
// record that outlives the setup it creates); this form's job is to keep sending the SAME key. In
// the start flow the key lives in sessionStorage, scoped to the signed-in provider (see
// onboarding-request-key-store.ts): hydration, re-render, reload, a network retry and back/forward
// navigation all reuse it, so a lost response is answered with the setup that already exists. It is
// forgotten when the upload succeeds or is resumed, replaced only when the provider explicitly
// starts another vehicle, and — if the provider leaves after an attempt whose outcome is unknown —
// cancelled on the server by key, so a delayed upload cannot create a setup behind their back.
// A synchronous guard still stops a double tap, but nothing depends on it.
//
// Without JavaScript the same <form> posts natively (multipart → 303) with the key the server
// rendered into it; that key is unique per rendered page, so the server still de-duplicates repeated
// submissions of that page, but it cannot survive a reload.

type Props = {
  /** Server route that receives the multipart POST. */
  action: string;
  locale: string;
  /** Start flow only: the idempotency key the server rendered (used as-is when there is no JavaScript). */
  requestKey?: string;
  /** Start flow only: opaque tag for the signed-in provider — the browser's key is scoped to it. */
  keyScope?: string;
  /** Extra fields (e.g. the document type when attaching to an existing unfinished setup). */
  hiddenFields?: Record<string, string>;
  /** Where to go when the server reports success without its own destination. */
  successHref?: string;
  /** Where the safe cancel/back control leads. */
  cancelHref: string;
  /** Photos and scans can be read automatically in this environment (an OCR engine is configured).
   *  Only changes the wording of the hint — never what the server does. */
  ocrAvailable?: boolean;
};

const ACCEPT_FILE = "application/pdf,image/jpeg,image/png";
const ACCEPT_CAMERA = "image/jpeg,image/png";
const CHOICE_CLASS =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/40";

type Phase = "idle" | "processing" | "uploading" | "done";

export function RegistrationUploadForm({ action, locale, requestKey, keyScope, hiddenFields, successHref, cancelHref, ocrAvailable = false }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // error keys resolved from a server code (parity-guaranteed)
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const leavingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // The start flow manages a durable key; attaching a document to an existing setup has none.
  const managed = Boolean(requestKey && keyScope);
  const keyRef = useRef<string | undefined>(requestKey);
  const attemptedRef = useRef(false);
  const [activeKey, setActiveKey] = useState<string | undefined>(requestKey); // mirrors keyRef for the no-JS field
  const [source, setSource] = useState<"camera" | "file" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [requestCancelled, setRequestCancelled] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!managed || !keyScope) return;
    // Adopt the tab's unresolved key if there is one; otherwise create and store one. Running this
    // again (re-render, StrictMode, a restored page) returns the same key — it is never replaced here.
    const sync = () => {
      const resolved = resolveOnboardingRequestKey(safeSessionStorage(), { scope: keyScope, generate: generateOnboardingRequestKey });
      keyRef.current = resolved.key;
      attemptedRef.current = resolved.attempted;
      setActiveKey(resolved.key);
    };
    sync();
    // A page restored from the back/forward cache continues the SAME attempt (same key) unless that
    // attempt was resolved meanwhile, in which case sync() starts a new one.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busyRef.current = false;
      leavingRef.current = false;
      setLeaving(false);
      setPhase("idle");
      setRequestCancelled(false);
      sync();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [managed, keyScope]);

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
    if (leavingRef.current) return; // the provider is leaving — nothing to show
    busyRef.current = false; // a retry is allowed — and safe: it carries the same request key
    setPhase("idle");
    if (code === "ONBOARDING_CANCELLED") setRequestCancelled(true); // terminal for THIS key
    setErrorKey(
      isAssetDocumentErrorCode(code)
        ? getAssetDocumentErrorTranslationKey(code)
        : isOnboardingRequestErrorCode(code)
          ? getOnboardingRequestErrorTranslationKey(code)
          : code === "NETWORK"
            ? "vehicleOnboardErrNetwork"
            : "vehicleOnboardUploadFailed",
    );
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || busyRef.current || requestCancelled) return;
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

    if (managed && keyScope) {
      // From here the server may act on this key even if we never see its answer.
      attemptedRef.current = true;
      markOnboardingKeyAttempted(safeSessionStorage(), keyScope);
    }

    let response: Response;
    try {
      abortRef.current = new AbortController();
      response = await fetch(action, { method: "POST", body, headers: { accept: "application/json" }, credentials: "same-origin", signal: abortRef.current.signal });
    } catch {
      return fail("NETWORK"); // connection dropped — nothing is lost; the same key makes a retry safe
    }

    let payload: { ok?: boolean; error?: string; redirectTo?: string } | null = null;
    try {
      payload = await response.json();
    } catch {
      /* a non-JSON answer (e.g. the platform refusing an oversized body) */
    }
    if (leavingRef.current) return;
    if (payload?.ok) {
      // Resolved (created or resumed): this attempt is over, so the browser forgets its key.
      if (managed) clearOnboardingRequestKey(safeSessionStorage());
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

  // EXPLICIT new attempt after the server said this key is cancelled: a different key, by request.
  const startNewSetup = () => {
    if (!managed || !keyScope) return;
    const next = rotateOnboardingRequestKey(safeSessionStorage(), { scope: keyScope, generate: generateOnboardingRequestKey });
    keyRef.current = next.key;
    attemptedRef.current = false;
    setActiveKey(next.key);
    setRequestCancelled(false);
    setErrorKey(null);
  };

  // Leaving the step. If a submission was started with this key and never resolved, its outcome is
  // unknown to the browser — so the request is cancelled ON THE SERVER by key before leaving.
  const onCancel = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!managed) return; // plain navigation
    if (requestCancelled || !attemptedRef.current || !keyRef.current) {
      if (requestCancelled) clearOnboardingRequestKey(safeSessionStorage()); // the server already holds the tombstone
      return; // plain navigation
    }
    event.preventDefault();
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    abortRef.current?.abort(); // stop sending; the server-side cancel below is what is authoritative
    const result = await cancelOnboardingRequestAction(keyRef.current).catch(() => ({ ok: false }));
    // Forget the key only when the server confirmed the cancellation (its tombstone stays). If it
    // could not be reached, the key is kept so a later visit resumes instead of duplicating.
    if (result.ok) clearOnboardingRequestKey(safeSessionStorage());
    router.push(cancelHref);
    router.refresh();
  };

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={onSubmit} aria-busy={busy} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {activeKey && <input type="hidden" name="requestKey" value={activeKey} />}
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
        <p className="text-xs text-foreground/60">{ocrAvailable ? t("vehicleOnboardFileHintOcr") : t("vehicleOnboardFileHint")}</p>
      </div>

      <p className="flex items-start gap-2 text-xs text-foreground/70">
        <Lock size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        <span>{t("vehicleOnboardPrivacyNote")}</span>
      </p>

      {/* The danger Alert is itself role="alert" (announced once); this wrapper only anchors the scroll. */}
      <div ref={errorRef} className="flex scroll-mb-40 scroll-mt-24 flex-col gap-3">
        {errorKey && <Alert variant="danger">{td(errorKey)}</Alert>}
        {requestCancelled && (
          <button
            type="button"
            onClick={startNewSetup}
            className="inline-flex min-h-12 w-fit items-center rounded-full border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("vehicleOnboardStartNew")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!file || busy || requestCancelled || leaving}
          className="inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          {phase === "processing" ? t("vehicleOnboardProcessingImage") : phase === "uploading" || phase === "done" ? t("vehicleOnboardUploading") : t("vehicleOnboardUploadButton")}
        </button>
        <Link
          href={cancelHref}
          onClick={onCancel}
          aria-disabled={leaving}
          className={`inline-flex min-h-12 items-center rounded-full border border-border px-6 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${leaving ? "pointer-events-none opacity-60" : ""}`}
        >
          {t("vehicleCancelLabel")}
        </Link>
      </div>
    </form>
  );
}
