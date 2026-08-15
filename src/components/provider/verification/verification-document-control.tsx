"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Upload, RefreshCw, Trash2, Eye, X, AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { clsx } from "@/components/ui/clsx";
import {
  CLIENT_ACCEPT_ATTR,
  preCheckFile,
  uploadReducer,
  progressView,
  initialUploadState,
} from "@/lib/provider/documents/upload-ui";
import {
  getProviderDocumentErrorTranslationKey,
  isProviderDocumentErrorCode,
} from "@/lib/provider/documents/provider-document-error-codes";

// Gate 0 — polished, mobile-first auto-upload control. Choosing a file starts
// the upload AUTOMATICALLY (no separate Upload button); the native
// "Choose File / No file selected" chrome is visually hidden behind a BARQ
// button. Progress is REAL (xhr.upload.onprogress) — determinate percent + bytes
// when the browser reports lengthComputable, an honest indeterminate bar
// otherwise; never a faked timer. All decisions live in the pure upload-ui
// module; this is the XHR/render shell. The server remains fully authoritative —
// this sends the SAME multipart request the progressive <form> did, only via XHR
// with `Accept: application/json` so it can read a result and drive progress.

type DocState = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  originalFilename: string;
  sizeBytes: number;
  versionToken: string;
} | null;

type Props = {
  locale: string;
  type: string;
  doc: DocState;
  canDelete: boolean;
  // When false, storage is unconfigured: uploading/replacing is not offered
  // (View + Delete of an existing doc still are). The parent only renders the
  // "new upload" case when storage IS available, so the new-upload path here is
  // always reached with storage present.
  storageAvailable: boolean;
};

const BTN_BASE =
  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed";

export function VerificationDocumentControl({ locale, type, doc, canDelete, storageAvailable }: Props) {
  const t = useTranslations("provider");
  const router = useRouter();
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [deleting, setDeleting] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const lastFileRef = useRef<File | null>(null);

  // Clear any transient upload/error state once the server data changes (a
  // completed upload/replace/delete → router.refresh brings a new doc identity).
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [doc?.id, doc?.versionToken]);

  // Abort any in-flight request if the control unmounts.
  useEffect(() => () => xhrRef.current?.abort(), []);

  function startUpload(file: File) {
    // Immediate client pre-check (obvious cases only; server re-validates).
    const pre = preCheckFile({ size: file.size, type: file.type });
    if (!pre.ok) {
      dispatch({ type: "ERROR", code: pre.error });
      return;
    }
    lastFileRef.current = file;
    dispatch({ type: "START", fileName: file.name, fileSize: file.size });

    const endpoint = doc ? `/api/provider/documents/${doc.id}/replace` : "/api/provider/documents";
    const form = new FormData();
    form.append("locale", locale);
    if (doc) form.append("versionToken", doc.versionToken);
    else form.append("type", type);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      dispatch({ type: "PROGRESS", loaded: e.loaded, total: e.total, lengthComputable: e.lengthComputable });
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status === 401) {
        window.location.assign(`/${locale}/login`);
        return;
      }
      let code = "UNKNOWN_ERROR";
      let ok = false;
      try {
        const body = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string };
        ok = body.ok === true;
        if (body.error) code = body.error;
      } catch {
        /* fall through to UNKNOWN_ERROR */
      }
      if (ok) {
        dispatch({ type: "SUCCESS" });
        router.refresh();
      } else {
        dispatch({ type: "ERROR", code });
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      dispatch({ type: "ERROR", code: "UPLOAD_FAILED" });
    };
    xhr.send(form);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same filename later (onChange fires only on change).
    e.target.value = "";
    if (file) startUpload(file);
  }

  function cancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    dispatch({ type: "CANCEL" });
  }

  function retry() {
    const file = lastFileRef.current;
    if (file) startUpload(file);
  }

  async function onDelete() {
    if (!doc) return;
    setDeleting(true);
    try {
      const form = new FormData();
      form.append("locale", locale);
      form.append("versionToken", doc.versionToken);
      const res = await fetch(`/api/provider/documents/${doc.id}/delete`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (res.status === 401) {
        window.location.assign(`/${locale}/login`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) {
        router.refresh();
      } else {
        dispatch({ type: "ERROR", code: body.error ?? "UNKNOWN_ERROR" });
      }
    } catch {
      dispatch({ type: "ERROR", code: "UPLOAD_FAILED" });
    } finally {
      setDeleting(false);
    }
  }

  const errorMessage =
    state.phase === "error" && state.errorCode && isProviderDocumentErrorCode(state.errorCode)
      ? t(getProviderDocumentErrorTranslationKey(state.errorCode))
      : state.phase === "error"
        ? t("documentErrorUnknown")
        : null;

  // ---- Uploading: real progress ----
  if (state.phase === "uploading") {
    const p = progressView(state);
    return (
      <div className="flex flex-col gap-2" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex items-center gap-2 text-sm text-foreground/70">
          <Loader2 size={15} strokeWidth={1.75} className="animate-spin text-primary" />
          <span role="status" aria-live="polite">
            {t("documentUploadingLabel")}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-accent/30"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.determinate ? (p.percent ?? undefined) : undefined}
          aria-label={t("documentUploadingLabel")}
        >
          <div
            className={clsx("h-full rounded-full bg-primary transition-[width] duration-150", !p.determinate && "w-1/3 animate-pulse")}
            style={p.determinate ? { width: `${p.percent}%` } : undefined}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-foreground/50">
          <span dir="ltr">
            {p.determinate ? `${p.loadedLabel} / ${p.totalLabel}` : p.loadedLabel}
          </span>
          {p.determinate && <span className="tabular-nums">{p.percent}%</span>}
        </div>
        <button type="button" onClick={cancel} className={clsx(BTN_BASE, "w-fit border border-border text-foreground/70 hover:bg-accent/20 px-3 py-1.5 text-xs")}>
          <X size={13} strokeWidth={1.75} />
          {t("documentUploadCancelButton")}
        </button>
      </div>
    );
  }

  const acceptDescription = <span className="text-xs text-foreground/40">{t("documentUploadHint")}</span>;

  // Hidden native input shared by both "new" and "replace" chooser buttons.
  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={CLIENT_ACCEPT_ATTR}
      onChange={onFileChange}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  const errorBlock = errorMessage && (
    <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3" role="alert">
      <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
      <div className="flex flex-col gap-2">
        <span className="text-sm text-foreground/80">{errorMessage}</span>
        {lastFileRef.current && (
          <button type="button" onClick={retry} className={clsx(BTN_BASE, "w-fit border border-border text-foreground/70 hover:bg-accent/20 px-3 py-1.5 text-xs")}>
            <RefreshCw size={13} strokeWidth={1.75} />
            {t("documentUploadRetryButton")}
          </button>
        )}
      </div>
    </div>
  );

  // ---- Existing document: summary actions (View / Replace / Delete) ----
  if (doc) {
    return (
      <div className="flex flex-col gap-3" dir={locale === "ar" ? "rtl" : "ltr"}>
        {errorBlock}
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/api/provider/documents/${doc.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(BTN_BASE, "border border-border text-foreground/70 hover:bg-accent/20")}
          >
            <Eye size={14} strokeWidth={1.75} />
            {t("documentViewButton")}
          </a>

          {storageAvailable && (
            <>
              {hiddenInput}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={clsx(BTN_BASE, "border border-border text-foreground/70 hover:bg-accent/20")}
              >
                <RefreshCw size={14} strokeWidth={1.75} />
                {t("documentReplaceButton")}
              </button>
            </>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className={clsx(BTN_BASE, "border border-danger/30 text-danger hover:bg-danger/5")}
            >
              {deleting ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.75} />}
              {t("documentDeleteButton")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- No document yet: custom auto-upload control ----
  return (
    <div className="flex flex-col gap-2" dir={locale === "ar" ? "rtl" : "ltr"}>
      {errorBlock}
      {hiddenInput}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={clsx(BTN_BASE, "w-fit bg-primary text-primary-foreground hover:opacity-90")}
      >
        <Upload size={15} strokeWidth={1.75} />
        {t("documentUploadButton")}
      </button>
      {acceptDescription}
    </div>
  );
}
