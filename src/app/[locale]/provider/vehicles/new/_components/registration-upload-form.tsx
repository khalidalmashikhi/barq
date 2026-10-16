"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, ChevronDown, FileText, FileUp, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { StickyActionBar } from "@/components/provider/registration-review/sticky-action-bar";
import { JOURNEY_CARD, JOURNEY_PRIMARY, JOURNEY_SECONDARY, JOURNEY_SMALL, JOURNEY_TERTIARY } from "@/components/provider/vehicle-journey/journey-ui";

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
  // Which file an error belongs to (shown next to it); null = a general / server error near the action.
  const [errorSlot, setErrorSlot] = useState<Slot | null>(null);
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
    setErrorSlot(null);
    if (slot === "back") {
      // The back side is a photo only; the input is cleared so a native post never carries it.
      event.target.value = "";
      if (chosen.type === "application/pdf") {
        setErrorSlot("back");
        return setErrorKey("vehicleDocErrorInvalidDocumentSet");
      }
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
          if (pages !== null && pages > MAX_REGISTRATION_PDF_PAGES) {
            setErrorSlot("front");
            setErrorKey("vehicleDocErrorPdfTooManyPages");
          }
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
    setErrorSlot(null);
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
  // A file-specific problem is shown next to that file; anything else (network, server) next to the action.
  const slotError = (slot: Slot) => (errorKey && errorSlot === slot ? <Alert variant="danger">{td(errorKey)}</Alert> : null);

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={onSubmit} aria-busy={busy} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {activeKey && <input type="hidden" name="requestKey" value={activeKey} />}
      {hiddenFields && Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

      <section className={JOURNEY_CARD} aria-labelledby="upload-title">
        {!front ? (
          // THE first action: one calm upload zone. Both choices are real <label>s around the file inputs
          // (camera → the phone's camera; choose → photo library or files).
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-secondary/40 bg-secondary/5 px-4 py-7 text-center">
            <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-card text-secondary-700 shadow-sm">
              <FileText size={28} strokeWidth={1.6} />
            </span>
            <h2 id="upload-title" className="text-lg font-semibold text-foreground">
              {t("vehicleJourneyUploadTitle")}
            </h2>
            <p className="max-w-sm text-sm text-foreground/70">{t("vehicleJourneyUploadHint")}</p>
            <div className="mt-1 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <label className={`${JOURNEY_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-offset-2 sm:min-w-56 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                <FileUp size={20} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardChooseFile")}
                <input ref={fileRef} type="file" accept={ACCEPT_FILE} name={source === "camera" ? undefined : "file"} onChange={pick("file")} className="sr-only" />
              </label>
              <label className={`${JOURNEY_SECONDARY} cursor-pointer focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-offset-2 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                <Camera size={20} strokeWidth={1.75} aria-hidden />
                {t("vehicleOnboardTakePhoto")}
                <input ref={cameraRef} type="file" accept={ACCEPT_CAMERA} capture="environment" name={source === "camera" ? "file" : undefined} onChange={pick("camera")} className="sr-only" />
              </label>
            </div>
            <p className="sr-only" aria-live="polite">
              {t("vehicleOnboardNoFileSelected")}
            </p>
            {slotError("front")}
          </div>
        ) : (
          // The chosen set, in ORDER: 1 front (or the PDF), 2 back (optional, photo only).
          <div className="flex flex-col gap-5">
            <h2 id="upload-title" className="text-lg font-semibold text-foreground">
              {t("vehicleJourneyUploadTitle")}
            </h2>
            {/* The inputs stay mounted (and never disabled) so a replace can reuse them. */}
            <input ref={cameraRef} type="file" accept={ACCEPT_CAMERA} capture="environment" name={source === "camera" ? "file" : undefined} onChange={pick("camera")} className="sr-only" tabIndex={-1} />
            <input ref={fileRef} type="file" accept={ACCEPT_FILE} name={source === "camera" ? undefined : "file"} onChange={pick("file")} className="sr-only" tabIndex={-1} />
            <ol className="flex flex-col gap-4">
              {/* SLOT 1 — the front side, or the PDF. */}
              <li className="flex flex-col gap-3">
                <p className="flex items-center gap-2">
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
                  <span className="form-label">{singleFile ? t("vehicleOnboardFileLabel") : t("vehicleOnboardFrontSlotLabel")}</span>
                </p>
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3">
                  {previews.front ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen photo, never uploaded through the image optimizer
                    <img src={previews.front} alt={t("vehicleOnboardPreviewAlt")} className="max-h-48 w-full rounded-xl bg-card object-contain" />
                  ) : null}
                  <p className="flex items-start gap-2 break-words text-sm text-foreground/80" aria-live="polite">
                    <FileText size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-secondary-700" />
                    <span>
                      <span className="sr-only">{frontIsPdf ? t("vehicleOnboardPdfSelected") : t("vehicleOnboardSelectedFileLabel")}: </span>
                      <bdi className="font-medium text-foreground">{front.name}</bdi>
                      <span className="text-foreground/70"> · {td("vehicleOnboardFileSizeMb", { size: megabytes(front.size) })}</span>
                      {frontIsPdf && <span className="text-foreground/70"> · {pdfPagesLabel}</span>}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => open("file", "front")} disabled={busy} className={JOURNEY_SMALL}>
                      <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
                      {t("vehicleOnboardReplaceFile")}
                    </button>
                    <button type="button" onClick={() => open("camera", "front")} disabled={busy} className={JOURNEY_SMALL}>
                      <Camera size={16} strokeWidth={1.75} aria-hidden />
                      {t("vehicleOnboardTakePhoto")}
                    </button>
                    <button type="button" onClick={() => removeSlot("front")} disabled={busy} className={`${JOURNEY_SMALL} text-danger`}>
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                      {t("vehicleOnboardRemoveFile")}
                    </button>
                  </div>
                  {frontIsPdf && !singleFile && <p className="text-sm text-foreground/70">{t("vehicleOnboardPdfExclusive")}</p>}
                </div>
                {slotError("front")}
              </li>

              {/* SLOT 2 — the optional back side (photo only), once a front PHOTO is in place. */}
              {canAddBack && (
                <li className="flex flex-col gap-3">
                  <p className="flex items-center gap-2">
                    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-xs font-semibold text-foreground/70">2</span>
                    <span className="form-label">{t("vehicleOnboardBackSlotLabel")}</span>
                  </p>
                  {!showBack && !back ? (
                    <button type="button" onClick={() => setShowBack(true)} disabled={busy} className={`${JOURNEY_SECONDARY} border-dashed`}>
                      <Plus size={18} strokeWidth={1.75} aria-hidden />
                      {t("vehicleOnboardAddBackSide")}
                    </button>
                  ) : back ? (
                    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3">
                      {previews.back ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen photo
                        <img src={previews.back} alt={t("vehicleOnboardBackPreviewAlt")} className="max-h-48 w-full rounded-xl bg-card object-contain" />
                      ) : null}
                      <p className="flex items-start gap-2 break-words text-sm text-foreground/80" aria-live="polite">
                        <FileText size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-secondary-700" />
                        <span>
                          <span className="sr-only">{t("vehicleOnboardSelectedFileLabel")}: </span>
                          <bdi className="font-medium text-foreground">{back.name}</bdi>
                          <span className="text-foreground/70"> · {td("vehicleOnboardFileSizeMb", { size: megabytes(back.size) })}</span>
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => open("file", "back")} disabled={busy} className={JOURNEY_SMALL}>
                          <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
                          {t("vehicleOnboardReplaceFile")}
                        </button>
                        <button type="button" onClick={() => open("camera", "back")} disabled={busy} className={JOURNEY_SMALL}>
                          <Camera size={16} strokeWidth={1.75} aria-hidden />
                          {t("vehicleOnboardTakePhoto")}
                        </button>
                        <button type="button" onClick={() => removeSlot("back")} disabled={busy} className={`${JOURNEY_SMALL} text-danger`}>
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                          {t("vehicleOnboardRemoveFile")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="button" onClick={() => open("file", "back")} disabled={busy} className={JOURNEY_SECONDARY}>
                        <FileUp size={18} strokeWidth={1.75} aria-hidden />
                        {t("vehicleOnboardChooseFile")}
                      </button>
                      <button type="button" onClick={() => open("camera", "back")} disabled={busy} className={JOURNEY_SECONDARY}>
                        <Camera size={18} strokeWidth={1.75} aria-hidden />
                        {t("vehicleOnboardTakePhoto")}
                      </button>
                    </div>
                  )}
                  {slotError("back")}
                </li>
              )}
            </ol>
          </div>
        )}
      </section>

      {/* Secondary information: one reassuring line, and the file requirements on request. */}
      <p className="flex items-start gap-2 text-sm text-foreground/70">
        <Lock size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        <span>{t("vehicleOnboardPrivacyNote")}</span>
      </p>
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <span>{t("vehicleJourneyFileRequirements")}</span>
          <ChevronDown size={18} strokeWidth={1.75} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm text-foreground/80">
          <p>{singleFile ? t("vehicleOnboardFileLabel") : t("vehicleOnboardSetInstruction")}</p>
          <p>{ocrAvailable ? t("vehicleOnboardFileHintOcr") : t("vehicleOnboardFileHint")}</p>
        </div>
      </details>

      {/* The danger Alert is itself role="alert" (announced once); this wrapper only anchors the scroll. */}
      <div ref={errorRef} className="flex scroll-mb-40 scroll-mt-24 flex-col gap-3">
        {errorKey && errorSlot === null && <Alert variant="danger">{td(errorKey)}</Alert>}
        {requestCancelled && (
          <button type="button" onClick={startNewSetup} className={`${JOURNEY_SECONDARY} w-fit`}>
            {t("vehicleOnboardStartNew")}
          </button>
        )}
      </div>

      {phase === "uploading" || phase === "done" ? (
        <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/15">
            <div className="h-full rounded-full bg-secondary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm text-foreground/70">{td("vehicleOnboardUploadProgress", { percent })}</p>
        </div>
      ) : null}

      {/* Sticky on phones: the actions stay clear of the browser's bottom toolbar. */}
      <StickyActionBar className="-mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={!front || busy || requestCancelled || leaving} className={`${JOURNEY_PRIMARY} w-full sm:w-auto sm:min-w-56`}>
          {phase === "processing" ? t("vehicleOnboardProcessingImage") : phase === "uploading" || phase === "done" ? t("vehicleOnboardUploading") : t("vehicleOnboardUploadButton")}
        </button>
        <Link href={cancelHref} onClick={onCancel} aria-disabled={leaving} className={`${JOURNEY_TERTIARY} ${leaving ? "pointer-events-none opacity-60" : ""}`}>
          {t("vehicleCancelLabel")}
        </Link>
      </StickyActionBar>
    </form>
  );
}
