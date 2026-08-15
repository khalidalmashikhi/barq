import { MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_MIME_TYPES } from "./document-constants";
import type { ProviderDocumentErrorCode } from "./provider-document-error-codes";

// Gate 0 — PURE, isomorphic logic for the auto-upload verification control. All
// stateful decisions (client pre-check, progress math, the upload state machine)
// live here so they are unit-tested without a DOM; the client component
// (verification-document-control.tsx) is a thin XHR/render shell over this.
//
// The client pre-check is a fast UX gate only — it blocks the OBVIOUS cases
// (empty, oversized, wrong browser MIME) before spending a request. It NEVER
// duplicates magic-byte trust: the server re-validates size + declared MIME +
// magic bytes and remains the sole authority (validateDocumentUpload).

export const CLIENT_MAX_DOCUMENT_BYTES = MAX_DOCUMENT_BYTES;

// The `accept` attribute + client MIME allow-list, derived from the SAME source
// the server validates against — they can never drift.
export const CLIENT_ALLOWED_MIME_TYPES: readonly string[] = Object.keys(ALLOWED_DOCUMENT_MIME_TYPES);
export const CLIENT_ACCEPT_ATTR = CLIENT_ALLOWED_MIME_TYPES.join(",");

// Human-readable size, LTR-safe in both scripts (e.g. "64 B", "512 KB", "2.4 MB").
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ClientPreCheckError = Extract<ProviderDocumentErrorCode, "EMPTY_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE">;
export type ClientPreCheckResult = { ok: true } | { ok: false; error: ClientPreCheckError };

// Immediate, obvious-only client gate. Order matches the server's
// validateDocumentUpload so the codes agree (empty → too-large → unsupported).
export function preCheckFile(file: { size: number; type: string }): ClientPreCheckResult {
  if (file.size <= 0) return { ok: false, error: "EMPTY_FILE" };
  if (file.size > CLIENT_MAX_DOCUMENT_BYTES) return { ok: false, error: "TOO_LARGE" };
  if (!CLIENT_ALLOWED_MIME_TYPES.includes(file.type)) return { ok: false, error: "UNSUPPORTED_TYPE" };
  return { ok: true };
}

// ---- Upload state machine (auto-upload + real progress) -------------------

export type UploadPhase = "idle" | "uploading" | "success" | "error";

export type UploadState = {
  phase: UploadPhase;
  fileName: string | null;
  fileSize: number | null; // the selected file's own size (fallback total)
  loaded: number;
  total: number | null; // bytes to transfer, per the XHR progress event
  lengthComputable: boolean;
  errorCode: string | null;
};

export const initialUploadState: UploadState = {
  phase: "idle",
  fileName: null,
  fileSize: null,
  loaded: 0,
  total: null,
  lengthComputable: false,
  errorCode: null,
};

export type UploadAction =
  | { type: "START"; fileName: string; fileSize: number }
  | { type: "PROGRESS"; loaded: number; total: number; lengthComputable: boolean }
  | { type: "SUCCESS" }
  | { type: "ERROR"; code: string }
  | { type: "CANCEL" }
  | { type: "RESET" };

export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "START":
      // Duplicate-submit guard: a selection while a request is in flight is a
      // no-op (the control is also disabled in the DOM, but the reducer is the
      // authoritative guard — no second concurrent request can ever start).
      if (state.phase === "uploading") return state;
      return {
        phase: "uploading",
        fileName: action.fileName,
        fileSize: action.fileSize,
        loaded: 0,
        total: action.fileSize,
        lengthComputable: false,
        errorCode: null,
      };
    case "PROGRESS":
      if (state.phase !== "uploading") return state;
      return {
        ...state,
        loaded: action.loaded,
        total: action.lengthComputable ? action.total : state.total,
        lengthComputable: action.lengthComputable,
      };
    case "SUCCESS":
      if (state.phase !== "uploading") return state;
      return { ...state, phase: "success", errorCode: null };
    case "ERROR":
      return { ...state, phase: "error", errorCode: action.code };
    case "CANCEL":
    case "RESET":
      return initialUploadState;
    default:
      return state;
  }
}

// Render selector: turns the raw state into what the progress UI shows. When the
// transfer size is unknown (no lengthComputable event yet) it is honestly
// indeterminate — never a faked percentage.
export type ProgressView = {
  determinate: boolean;
  percent: number | null;
  loadedLabel: string;
  totalLabel: string | null;
};

export function progressView(state: UploadState): ProgressView {
  const total = state.lengthComputable && state.total && state.total > 0 ? state.total : null;
  if (total === null) {
    return { determinate: false, percent: null, loadedLabel: formatFileSize(state.loaded), totalLabel: null };
  }
  const percent = Math.max(0, Math.min(100, Math.round((state.loaded / total) * 100)));
  return {
    determinate: true,
    percent,
    loadedLabel: formatFileSize(state.loaded),
    totalLabel: formatFileSize(total),
  };
}
