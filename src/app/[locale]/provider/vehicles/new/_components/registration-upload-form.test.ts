import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSET_DOCUMENT_ERROR_CODES, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { ALLOWED_DOCUMENT_MIME_TYPES } from "@/lib/provider/documents/document-constants";
import { MAX_UPLOAD_BYTES } from "@/lib/vehicles/documents/document-upload-policy";
import { MAX_REGISTRATION_PDF_PAGES } from "@/lib/vehicles/registration-extraction/constants";

// The upload form is a client island (hooks + fetch + canvas) and this suite has no DOM, so its
// CONTRACT is asserted structurally: what the two pickers accept, that nothing here is the
// idempotency control, and that every message a provider can be shown exists — honestly worded — in
// all eight languages. Real-device behavior (iPhone camera / photo library) is NOT covered by
// automated tests and must be checked by hand on a phone.

const ROOT = process.cwd();
const SOURCE = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/_components/registration-upload-form.tsx"), "utf8");
const CODE = SOURCE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", locale, "provider.json"), "utf8")) as Record<string, string>;

describe("RegistrationUploadForm — pickers", () => {
  const acceptFile = /const ACCEPT_FILE = "([^"]+)"/.exec(CODE)![1]!.split(",");
  const acceptCamera = /const ACCEPT_CAMERA = "([^"]+)"/.exec(CODE)![1]!.split(",");

  it("the file picker offers exactly PDF, JPEG and PNG — every one of which the server accepts", () => {
    expect(acceptFile).toEqual(["application/pdf", "image/jpeg", "image/png"]);
    for (const mime of acceptFile) expect(Object.keys(ALLOWED_DOCUMENT_MIME_TYPES)).toContain(mime);
  });

  it("the camera control asks for a JPEG/PNG still from the rear camera (so a phone hands over a supported format)", () => {
    expect(acceptCamera).toEqual(["image/jpeg", "image/png"]);
    expect(CODE).toMatch(/accept=\{ACCEPT_CAMERA\} capture="environment"/);
  });

  it("HEIC/HEIF is never advertised by either picker", () => {
    expect([...acceptFile, ...acceptCamera].join(",")).not.toMatch(/hei[cf]|image\/\*/i);
  });

  it("'take a photo' and 'choose a photo or file' are two separate controls", () => {
    expect(CODE).toMatch(/t\("vehicleOnboardTakePhoto"\)/);
    expect(CODE).toMatch(/t\("vehicleOnboardChooseFile"\)/);
    expect((CODE.match(/type="file"/g) ?? []).length).toBe(2);
  });

  it("the file inputs are never disabled (a disabled input drops its file from the request)", () => {
    const inputs = CODE.match(/<input[^>]*type="file"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).not.toMatch(/disabled/);
  });
});

describe("RegistrationUploadForm — submission", () => {
  it("sends the server-issued request key with every attempt, and asks for a JSON answer", () => {
    expect(CODE).toMatch(/body\.set\("requestKey", keyRef\.current\)/);
    expect(CODE).toMatch(/accept: "application\/json"/);
    // …and the same key is in the plain form for the no-JavaScript path.
    expect(CODE).toMatch(/<input type="hidden" name="requestKey" value=\{requestKey\} \/>/);
  });

  it("a failed attempt can be retried with the SAME key (the guard is released; the key is not regenerated)", () => {
    const fail = /const fail = \(code: string\) => \{([\s\S]*?)\n  \};/.exec(CODE)![1]!;
    expect(fail).toMatch(/busyRef\.current = false/);
    expect(fail).not.toMatch(/keyRef\.current =/);
  });

  it("shows distinct progress for preparing the photo and for uploading", () => {
    expect(CODE).toMatch(/setPhase\("processing"\)/);
    expect(CODE).toMatch(/setPhase\("uploading"\)/);
    expect(CODE).toMatch(/vehicleOnboardProcessingImage/);
    expect(CODE).toMatch(/vehicleOnboardUploading/);
  });

  it("the error is announced and scrolled into view above the action buttons (not hidden behind browser chrome)", () => {
    // A danger Alert is role="alert" — announced once; the wrapper must not be a second live region.
    expect(CODE).toMatch(/\{errorKey && <Alert variant="danger">\{td\(errorKey\)\}<\/Alert>\}/);
    expect(CODE).not.toMatch(/aria-live="assertive"/);
    expect(CODE).toMatch(/scrollIntoView/);
    expect(CODE.indexOf("ref={errorRef}")).toBeLessThan(CODE.indexOf('type="submit"'));
  });

  it("does not persist or log the key, and never puts it in a URL", () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|console\./);
    expect(CODE).not.toMatch(/\?requestKey|requestKey=\$\{/);
  });
});

describe("upload copy — complete and honest in all 8 languages", () => {
  const FORM_KEYS = [
    "vehicleOnboardFileLabel", "vehicleOnboardTakePhoto", "vehicleOnboardChooseFile", "vehicleOnboardSelectedFileLabel", "vehicleOnboardNoFileSelected",
    "vehicleOnboardFileHint", "vehicleOnboardPrivacyNote", "vehicleOnboardUploadButton", "vehicleOnboardProcessingImage", "vehicleOnboardUploading",
    "vehicleOnboardErrNetwork", "vehicleOnboardUploadFailed", "vehicleOnboardResumedNotice", "vehicleOnboardManualNotice", "vehicleCancelLabel",
  ];
  const ERROR_KEYS = ASSET_DOCUMENT_ERROR_CODES.map(getAssetDocumentErrorTranslationKey);

  it.each(LOCALES)("%s has every form string and every document error message, none empty", (locale) => {
    const m = messages(locale);
    for (const key of [...FORM_KEYS, ...ERROR_KEYS]) expect(m[key], `${locale}:${key}`).toEqual(expect.stringMatching(/\S/));
  });

  it.each(LOCALES)("%s: the format hint names PDF, JPG and PNG, states the real PDF limit, and does not promise HEIC", (locale) => {
    const hint = messages(locale).vehicleOnboardFileHint!;
    for (const word of ["PDF", "JPG", "PNG"]) expect(hint).toContain(word);
    expect(hint).toContain(String(MAX_UPLOAD_BYTES / (1024 * 1024))); // "4"
    expect(hint).not.toMatch(/HEIC|HEIF/i);
  });

  it.each(LOCALES)("%s: the HEIC message names the format and offers supported alternatives", (locale) => {
    const msg = messages(locale).vehicleDocErrorHeicUnsupported!;
    expect(msg).toContain("HEIC");
    for (const word of ["JPG", "PNG", "PDF"]) expect(msg).toContain(word);
  });

  it.each(LOCALES)("%s: the limits quoted in error messages are the real ones", (locale) => {
    const m = messages(locale);
    expect(m.vehicleDocErrorTooLarge).toContain(String(MAX_UPLOAD_BYTES / (1024 * 1024)));
    expect(m.vehicleDocErrorPdfTooManyPages).toContain(String(MAX_REGISTRATION_PDF_PAGES));
  });

  it.each(LOCALES)("%s: no upload string claims photos are read automatically (there is no OCR)", (locale) => {
    const m = messages(locale);
    // The manual-review notice must exist and must not be contradicted by an "OCR"/"AI reads" claim.
    for (const key of [...FORM_KEYS, ...ERROR_KEYS]) expect(m[key]).not.toMatch(/\bOCR\b|\bAI\b/);
  });

  it("the Arabic brand spelling stays correct", () => {
    expect(JSON.stringify(messages("ar"))).not.toContain("بارق");
  });
});
