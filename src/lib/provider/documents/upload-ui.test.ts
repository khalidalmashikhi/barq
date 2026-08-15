import { describe, it, expect } from "vitest";
import {
  preCheckFile,
  formatFileSize,
  uploadReducer,
  initialUploadState,
  progressView,
  CLIENT_MAX_DOCUMENT_BYTES,
  CLIENT_ALLOWED_MIME_TYPES,
  CLIENT_ACCEPT_ATTR,
  type UploadState,
} from "./upload-ui";

describe("upload-ui: client allow-list (derived from the server's source)", () => {
  it("exposes exactly the four server-accepted MIME types", () => {
    expect(CLIENT_ALLOWED_MIME_TYPES).toEqual(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    expect(CLIENT_ACCEPT_ATTR).toBe("application/pdf,image/jpeg,image/png,image/webp");
  });
  it("caps at 4 MB", () => {
    expect(CLIENT_MAX_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("upload-ui: preCheckFile (obvious-only client gate)", () => {
  it("accepts a valid in-limit PDF", () => {
    expect(preCheckFile({ size: 1024, type: "application/pdf" })).toEqual({ ok: true });
  });
  it("blocks an empty file before any request", () => {
    expect(preCheckFile({ size: 0, type: "application/pdf" })).toEqual({ ok: false, error: "EMPTY_FILE" });
  });
  it("blocks an oversized file before any request", () => {
    expect(preCheckFile({ size: CLIENT_MAX_DOCUMENT_BYTES + 1, type: "image/png" })).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });
  it("blocks an unsupported browser MIME before any request", () => {
    expect(preCheckFile({ size: 1024, type: "image/svg+xml" })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(preCheckFile({ size: 1024, type: "text/html" })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });
  it("accepts a file exactly at the max", () => {
    expect(preCheckFile({ size: CLIENT_MAX_DOCUMENT_BYTES, type: "image/webp" })).toEqual({ ok: true });
  });
});

describe("upload-ui: formatFileSize", () => {
  it("formats B / KB / MB", () => {
    expect(formatFileSize(64)).toBe("64 B");
    expect(formatFileSize(512 * 1024)).toBe("512 KB");
    expect(formatFileSize(Math.round(2.4 * 1024 * 1024))).toBe("2.4 MB");
  });
  it("returns empty string for invalid sizes", () => {
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });
});

describe("upload-ui: uploadReducer (auto-upload state machine)", () => {
  it("a valid selection auto-starts the upload (idle → uploading)", () => {
    const s = uploadReducer(initialUploadState, { type: "START", fileName: "id.pdf", fileSize: 2048 });
    expect(s.phase).toBe("uploading");
    expect(s.fileName).toBe("id.pdf");
    expect(s.total).toBe(2048);
    expect(s.errorCode).toBeNull();
  });

  it("a second selection while uploading cannot start a second request (duplicate guard)", () => {
    const uploading = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 10 });
    const again = uploadReducer(uploading, { type: "START", fileName: "b.pdf", fileSize: 999 });
    expect(again).toBe(uploading); // unchanged reference — no new upload
    expect(again.fileName).toBe("a.pdf");
  });

  it("tracks determinate progress", () => {
    let s: UploadState = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 1000 });
    s = uploadReducer(s, { type: "PROGRESS", loaded: 250, total: 1000, lengthComputable: true });
    const v = progressView(s);
    expect(v.determinate).toBe(true);
    expect(v.percent).toBe(25);
    expect(v.totalLabel).not.toBeNull();
  });

  it("is honestly indeterminate when total is unknown (no faked percentage)", () => {
    let s: UploadState = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 1000 });
    s = uploadReducer(s, { type: "PROGRESS", loaded: 250, total: 0, lengthComputable: false });
    const v = progressView(s);
    expect(v.determinate).toBe(false);
    expect(v.percent).toBeNull();
    expect(v.totalLabel).toBeNull();
  });

  it("clamps determinate percent to 0..100", () => {
    let s: UploadState = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 100 });
    s = uploadReducer(s, { type: "PROGRESS", loaded: 500, total: 100, lengthComputable: true });
    expect(progressView(s).percent).toBe(100);
  });

  it("reaches the success state only from uploading", () => {
    const uploading = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 10 });
    expect(uploadReducer(uploading, { type: "SUCCESS" }).phase).toBe("success");
    // SUCCESS is ignored if not uploading (e.g. after a cancel)
    expect(uploadReducer(initialUploadState, { type: "SUCCESS" }).phase).toBe("idle");
  });

  it("maps a failure to the error state with its code, and supports retry (kept file re-STARTs)", () => {
    const uploading = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 10 });
    const errored = uploadReducer(uploading, { type: "ERROR", code: "UPLOAD_FAILED" });
    expect(errored.phase).toBe("error");
    expect(errored.errorCode).toBe("UPLOAD_FAILED");
    // retry: a fresh START from the error state moves back to uploading
    const retried = uploadReducer(errored, { type: "START", fileName: "a.pdf", fileSize: 10 });
    expect(retried.phase).toBe("uploading");
    expect(retried.errorCode).toBeNull();
  });

  it("cancel/reset returns to the initial idle state", () => {
    const uploading = uploadReducer(initialUploadState, { type: "START", fileName: "a.pdf", fileSize: 10 });
    expect(uploadReducer(uploading, { type: "CANCEL" })).toEqual(initialUploadState);
    expect(uploadReducer(uploading, { type: "RESET" })).toEqual(initialUploadState);
  });
});
