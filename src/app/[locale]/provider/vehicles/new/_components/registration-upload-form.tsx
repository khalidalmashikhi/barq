"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileUp, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { prepareFileForUpload } from "@/lib/vehicles/documents/client-upload-file";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { isOnboardingRequestErrorCode, getOnboardingRequestErrorTranslationKey } from "@/lib/vehicles/onboarding/onboarding-request-errors";
import { MAX_REGISTRATION_PDF_PAGES } from "@/lib/vehicles/registration-extraction/constants";
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
// document is uploaded.
//
// THE SET (registration document set): the provider supplies exactly one of — a PDF of one or two
// pages; one photo of the front; two ORDERED photos, front then back. Two slots: the first is the
// front/primary (camera or picker: PDF, JPG, PNG); the second, "add the back side", is optional and
// takes a photo only. A PDF stands in for the photos — choosing one hides the back slot (and drops
// a back photo already chosen); once a photo is chosen the picker offers images only. Either slot
// can be replaced or removed before submitting, both photos are previewed, a PDF shows its name,
// size and page count (counted on the device; the server re-counts). Order is preserved: the front
// is always sent as `file`, the back as `back`.
//
// The upload goes by XMLHttpRequest so the provider sees ONE aggregate progress bar for the whole
// set (preparing the photos → uploading x%), errors stay on screen next to the button, and a failed
// attempt can simply be retried. A synchronous guard stops a double tap.
//
// ONE STABLE REQUEST KEY PER ATTEMPT. The server makes a request key idempotent (a durable request
// record that outlives the setup it creates); this form's job is to keep sending the SAME key. In
// the start flow the key lives in sessionStorage, scoped to the signed-in provider (see
// onboarding-request-key-store.ts): hydration, re-render, reload, a network retry and back/forward
// navigation all reuse it, so a lost response is answered with the setup that already exists. It is
// forgotten when the upload succeeds or is resumed, replaced only when the provider explicitly
// starts another vehicle, and — if the provider leaves after an attempt whose outcome is unknown —
// cancelled on the server by key, so a delayed upload cannot create a setup behind their back.
//
// Without JavaScript the same <form> posts natively (multipart → 303) with the key the server
// rendered into it and the front file alone; that key is unique per rendered page, so the server
// still de-duplicates repeated submissions of that page, but it cannot survive a reload.

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
  /** Attaching ONE document to an existing setup (per-document route): no back slot. */
  singleFile?: boolean;
};

const ACCEPT_FILE = "application/pdf,image/jpeg,image/png";
const ACCEPT_IMAGE_FILE = "image/jpeg,image/png";
const ACCEPT_CAMERA = "image/jpeg,image/png";
const CHOICE_CLASS =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/40";
const SMALL_BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

type Phase = "idle" | "processing" | "uploading" | "done";
type Slot = "front" | "back";

/** Count the pages of a PDF on the device from its object dictionaries (a best effort for display
 *  and an early "too many pages" message; the server re-counts with a real parser). */
function countPdfPages(bytes: ArrayBuffer): number | null {
  try {
    const text = new TextDecoder("latin1").decode(new Uint8Array(bytes));
    const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1);
}

export function RegistrationUploadForm({ action, locale, requestKey, keyScope, hiddenFields, successHref, cancelHref, ocrAvailable = false, singleFile = false }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string; // error keys resolved from a server code (parity-guaranteed)
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const leavingRef = useRef(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  // Which slot the next picked file goes to (the two inputs are shared by both slots).
  const targetRef = useRef<Slot>("front");
  // The start flow manages a durable key; attaching a document to an existing setup has none.
  const managed = Boolean(requestKey && keyScope);
  const keyRef = useRef<string | undefined>(requestKey);
  const attemptedRef = useRef(false);
  const [activeKey, setActiveKey] = useState<string | undefined>(requestKey); // mirrors keyRef for the no-JS field
  const [source, setSource] = useState<"camera" | "file" | null>(null);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [previews, setPreviews] = useState<{ front: string | null; back: string | null }>({ front: null, back: null });
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [requestCancelled, setRequestCancelled] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const frontIsPdf = front?.type === "application/pdf";

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

  // Inline previews for photos (object URLs are released when the file changes or on unmount).
  useEffect(() => {
    const url = front && front.type.startsWith("image/") ? URL.createObjectURL(front) : null;
    setPreviews((p) => ({ ...p, front: url }));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [front]);
  useEffect(() => {
    const url = back ? URL.createObjectURL(back) : null;
    setPreviews((p) => ({ ...p, back: url }));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [back]);

  const busy = phase !== "idle";

  const pick = (which: "camera" | "file") => (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    if (!chosen) return;
    const slot = targetRef.current;
    targetRef.current = "front";
    setErrorKey(null);
    if (slot === "back") {
      // The back side is a photo only; the input is cleared so a native post never carries it.
      event.target.value = "";
      if (chosen.type === "application/pdf") return setErrorKey("vehicleDocErrorInvalidDocumentSet");
      setBack(chosen);
      return;
    }
    const other = which === "camera" ? fileRef.current : cameraRef.current;
    if (other) other.value = ""; // only one front file at a time
    setSource(which);
    setFront(chosen);
    if (chosen.type === "application/pdf") {
      // A PDF is the whole document: it replaces any back photo and hides the back slot.
      setBack(null);
      setShowBack(false);
      setPdfPages(null);
      chosen
        .arrayBuffer()
        .then((bytes) => {
          const pages = countPdfPages(bytes);
          setPdfPages(pages);
          if (pages !== null && pages > MAX_REGISTRATION_PDF_PAGES) setErrorKey("vehicleDocErrorPdfTooManyPages");
        })
        .catch(() => setPdfPages(null));
    } else {
      setPdfPages(null);
    }
  };

  // Open the camera or the picker FOR A GIVEN SLOT. The picker offers PDFs only while no photo is
  // part of the set (a PDF never travels with a photo).
  const open = (which: "camera" | "file", slot: Slot) => {
    if (busy) return;
    targetRef.current = slot;
    const input = which === "camera" ? cameraRef.current : fileRef.current;
    if (!input) return;
    if (which === "file") input.accept = slot === "back" || (front && !frontIsPdf) || back ? ACCEPT_IMAGE_FILE : ACCEPT_FILE;
    input.value = "";
    input.click();
  };

  const removeSlot = (slot: Slot) => {
    if (busy) return;
    setErrorKey(null);
    if (slot === "back") {
      setBack(null);
      return;
    }
    setFront(null);
    setPdfPages(null);
    setSource(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  };

  const fail = (code: string) => {
    if (leavingRef.current) return; // the provider is leaving — nothing to show
    busyRef.current = false; // a retry is allowed — and safe: it carries the same request key
    setPhase("idle");
    setPercent(0);
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
    if (!front || busyRef.current || requestCancelled) return;
    busyRef.current = true;
    setErrorKey(null);

    setPhase("processing");
    const preparedFront = await prepareFileForUpload(front);
    if (!preparedFront.ok) return fail(preparedFront.error);
    // The set's shape is decided on the device too (the server decides again from the bytes).
    if (back && preparedFront.blob.type === "application/pdf") return fail("INVALID_DOCUMENT_SET");
    const preparedBack = back ? await prepareFileForUpload(back) : null;
    if (preparedBack && !preparedBack.ok) return fail(preparedBack.error);

    setPhase("uploading");
    setPercent(0);
    const body = new FormData();
    body.set("locale", locale);
    if (keyRef.current) body.set("requestKey", keyRef.current);
    for (const [name, value] of Object.entries(hiddenFields ?? {})) body.set(name, value);
    body.set("file", preparedFront.blob, preparedFront.filename);
    if (preparedBack && preparedBack.ok) body.set("back", preparedBack.blob, preparedBack.filename); // ORDER: front first, then back

    if (managed && keyScope) {
      // From here the server may act on this key even if we never see its answer.
      attemptedRef.current = true;
      markOnboardingKeyAttempted(safeSessionStorage(), keyScope);
    }

    // ONE request for the whole set → one aggregate progress figure for both files.
    let response: { status: number; text: string };
    try {
      response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", action);
        xhr.setRequestHeader("accept", "application/json");
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setPercent(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        };
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => reject(new Error("network"));
        xhr.onabort = () => reject(new Error("aborted"));
        xhr.send(body);
      });
    } catch {
      return fail("NETWORK"); // connection dropped — nothing is lost; the same key makes a retry safe
    } finally {
      xhrRef.current = null;
    }

    let payload: { ok?: boolean; error?: string; redirectTo?: string } | null = null;
    try {
      payload = JSON.parse(response.text);
    } catch {
      /* a non-JSON answer (e.g. the platform refusing an oversized body) */
    }
    if (leavingRef.current) return;
    if (payload?.ok) {
      // Resolved (created or resumed): this attempt is over, so the browser forgets its key.
      if (managed) clearOnboardingRequestKey(safeSessionStorage());
      setPercent(100);
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
    xhrRef.current?.abort(); // stop sending; the server-side cancel below is what is authoritative
    const result = await cancelOnboardingRequestAction(keyRef.current).catch(() => ({ ok: false }));
    // Forget the key only when the server confirmed the cancellation (its tombstone stays). If it
    // could not be reached, the key is kept so a later visit resumes instead of duplicating.
    if (result.ok) clearOnboardingRequestKey(safeSessionStorage());
    router.push(cancelHref);
    router.refresh();
  };

  const pdfPagesLabel = pdfPages === null ? t("vehicleOnboardPdfPagesUnknown") : pdfPages === 1 ? t("vehicleOnboardPdfPagesOne") : pdfPages === 2 ? t("vehicleOnboardPdfPagesTwo") : td("vehicleOnboardPdfPagesMany", { count: pdfPages });
  const canAddBack = !singleFile && front !== null && !frontIsPdf;

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={onSubmit} aria-busy={busy} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {activeKey && <input type="hidden" name="requestKey" value={activeKey} />}
      {hiddenFields && Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

      <p className="text-sm font-medium text-foreground">{singleFile ? t("vehicleOnboardFileLabel") : t("vehicleOnboardSetInstruction")}</p>

      {/* SLOT 1 — the front side, or the PDF. The two inputs are shared with the back slot. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-accent/10 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">{singleFile ? t("vehicleOnboardFileLabel") : t("vehicleOnboardFrontSlotLabel")}</p>
        {!front && (
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
        )}
        {front && (
          <div className="flex flex-col gap-3">
            {/* The inputs stay mounted (and never disabled) so a replace can reuse them. */}
            <input ref={cameraRef} type="file" accept={ACCEPT_CAMERA} capture="environment" name={source === "camera" ? "file" : undefined} onChange={pick("camera")} className="sr-only" tabIndex={-1} />
            <input ref={fileRef} type="file" accept={ACCEPT_FILE} name={source === "camera" ? undefined : "file"} onChange={pick("file")} className="sr-only" tabIndex={-1} />
            {previews.front ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen photo, never uploaded through the image optimizer
              <img src={previews.front} alt={t("vehicleOnboardPreviewAlt")} className="max-h-56 w-full rounded-xl border border-border bg-background object-contain" />
            ) : null}
            <p className="break-words text-sm text-foreground/80" aria-live="polite">
              <span className="text-foreground/60">{frontIsPdf ? t("vehicleOnboardPdfSelected") : t("vehicleOnboardSelectedFileLabel")}: </span>
              <bdi>{front.name}</bdi>
              <span className="text-foreground/60"> · {td("vehicleOnboardFileSizeMb", { size: megabytes(front.size) })}</span>
              {frontIsPdf && <span className="text-foreground/60"> · {pdfPagesLabel}</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => open("camera", "front")} disabled={busy} className={SMALL_BUTTON}>
                <Camera size={14} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardTakePhoto")}
              </button>
              <button type="button" onClick={() => open("file", "front")} disabled={busy} className={SMALL_BUTTON}>
                <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardReplaceFile")}
              </button>
              <button type="button" onClick={() => removeSlot("front")} disabled={busy} className={SMALL_BUTTON}>
                <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardRemoveFile")}
              </button>
            </div>
          </div>
        )}
        {!front && (
          <p className="text-sm text-foreground/50" aria-live="polite">
            {t("vehicleOnboardNoFileSelected")}
          </p>
        )}
        <p className="text-xs text-foreground/60">{ocrAvailable ? t("vehicleOnboardFileHintOcr") : t("vehicleOnboardFileHint")}</p>
        {frontIsPdf && !singleFile && <p className="text-xs text-foreground/60">{t("vehicleOnboardPdfExclusive")}</p>}
      </div>

      {/* SLOT 2 — the optional back side (photo only), shown once a front PHOTO is in place. */}
      {canAddBack && !showBack && !back && (
        <button type="button" onClick={() => setShowBack(true)} disabled={busy} className="inline-flex min-h-12 w-fit items-center gap-2 rounded-full border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          {t("vehicleOnboardAddBackSide")}
        </button>
      )}
      {canAddBack && (showBack || back) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-accent/10 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">{t("vehicleOnboardBackSlotLabel")}</p>
          {back ? (
            <div className="flex flex-col gap-3">
              {previews.back ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen photo
                <img src={previews.back} alt={t("vehicleOnboardBackPreviewAlt")} className="max-h-56 w-full rounded-xl border border-border bg-background object-contain" />
              ) : null}
              <p className="break-words text-sm text-foreground/80" aria-live="polite">
                <span className="text-foreground/60">{t("vehicleOnboardSelectedFileLabel")}: </span>
                <bdi>{back.name}</bdi>
                <span className="text-foreground/60"> · {td("vehicleOnboardFileSizeMb", { size: megabytes(back.size) })}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => open("camera", "back")} disabled={busy} className={SMALL_BUTTON}>
                  <Camera size={14} strokeWidth={1.75} aria-hidden />
                  {t("vehicleOnboardTakePhoto")}
                </button>
                <button type="button" onClick={() => open("file", "back")} disabled={busy} className={SMALL_BUTTON}>
                  <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
                  {t("vehicleOnboardReplaceFile")}
                </button>
                <button type="button" onClick={() => removeSlot("back")} disabled={busy} className={SMALL_BUTTON}>
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  {t("vehicleOnboardRemoveFile")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => open("camera", "back")} disabled={busy} className={CHOICE_CLASS}>
                <Camera size={18} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardTakePhoto")}
              </button>
              <button type="button" onClick={() => open("file", "back")} disabled={busy} className={CHOICE_CLASS}>
                <FileUp size={18} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardChooseFile")}
              </button>
            </div>
          )}
        </div>
      )}

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

      {phase === "uploading" || phase === "done" ? (
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-accent/30">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-foreground/70">{td("vehicleOnboardUploadProgress", { percent })}</p>
        </div>
      ) : null}

      {/* Sticky on phones: the actions stay clear of the browser's bottom toolbar. */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button
          type="submit"
          disabled={!front || busy || requestCancelled || leaving}
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
