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
  const fn = (name: string) => new RegExp(`const ${name} = [^\\n]*\\{\\n([\\s\\S]*?)\\n  \\};`).exec(CODE)![1]!;

  it("sends the request key with every attempt, and asks for a JSON answer", () => {
    expect(CODE).toMatch(/body\.set\("requestKey", keyRef\.current\)/);
    expect(CODE).toMatch(/accept: "application\/json"/);
    // …and the ACTIVE key is in the plain form too (the server-rendered one until hydration).
    expect(CODE).toMatch(/\{activeKey && <input type="hidden" name="requestKey" value=\{activeKey\} \/>\}/);
  });

  it("the key comes from the tab's provider-scoped store and is NEVER replaced by rendering, retrying or restoring the page", () => {
    // Adopt-or-create on mount and on a restored page: resolve(), which never replaces a usable key.
    expect(CODE).toMatch(/resolveOnboardingRequestKey\(safeSessionStorage\(\), \{ scope: keyScope, generate: generateOnboardingRequestKey \}\)/);
    // A NEW key is produced in exactly one place: the explicit "start a new setup" action.
    expect((CODE.match(/rotateOnboardingRequestKey\(/g) ?? []).length).toBe(1);
    expect(fn("startNewSetup")).toMatch(/rotateOnboardingRequestKey\(/);
    for (const name of ["fail", "onSubmit", "onCancel", "pick"]) expect(fn(name)).not.toMatch(/rotateOnboardingRequestKey|generateOnboardingRequestKey|keyRef\.current =/);
    // The form itself never mints keys ad hoc.
    expect(CODE).not.toMatch(/crypto\.randomUUID|Math\.random/);
  });

  it("a failed attempt can be retried with the SAME key (the guard is released; the key is untouched)", () => {
    expect(fn("fail")).toMatch(/busyRef\.current = false/);
    expect(fn("fail")).not.toMatch(/clearOnboardingRequestKey|keyRef/);
  });

  it("records that an attempt started BEFORE the request leaves (its answer may never arrive)", () => {
    const submit = fn("onSubmit");
    expect(submit.indexOf("markOnboardingKeyAttempted(")).toBeGreaterThan(0);
    expect(submit.indexOf("markOnboardingKeyAttempted(")).toBeLessThan(submit.indexOf("await fetch("));
  });

  it("the browser forgets its key only when the attempt is RESOLVED (created or resumed), before navigating", () => {
    const submit = fn("onSubmit");
    const cleared = submit.indexOf("clearOnboardingRequestKey(safeSessionStorage())");
    expect(cleared).toBeGreaterThan(submit.indexOf("if (payload?.ok)"));
    expect(cleared).toBeLessThan(submit.indexOf("router.push(payload.redirectTo"));
    expect((submit.match(/clearOnboardingRequestKey\(/g) ?? []).length).toBe(1); // never on a failure path
  });

  it("a key the server reports CANCELLED is terminal: submitting is blocked until the provider explicitly starts a new setup", () => {
    expect(fn("fail")).toMatch(/if \(code === "ONBOARDING_CANCELLED"\) setRequestCancelled\(true\)/);
    expect(fn("onSubmit")).toMatch(/if \(!file \|\| busyRef\.current \|\| requestCancelled\) return/);
    expect(CODE).toMatch(/disabled=\{!file \|\| busy \|\| requestCancelled \|\| leaving\}/);
    expect(CODE).toMatch(/\{requestCancelled && \(\s*<button\s+type="button"\s+onClick=\{startNewSetup\}/);
    expect(CODE).toMatch(/t\("vehicleOnboardStartNew"\)/);
  });

  it("leaving after an attempt of unknown outcome cancels the request ON THE SERVER by key; the key is kept if that could not be confirmed", () => {
    const cancel = fn("onCancel");
    expect(cancel).toMatch(/!attemptedRef\.current/); // nothing sent → plain navigation, nothing to cancel
    expect(cancel).toMatch(/abortRef\.current\?\.abort\(\)/);
    expect(cancel).toMatch(/await cancelOnboardingRequestAction\(keyRef\.current\)/);
    expect(cancel).toMatch(/if \(result\.ok\) clearOnboardingRequestKey\(safeSessionStorage\(\)\)/);
    expect(cancel.indexOf("cancelOnboardingRequestAction(")).toBeLessThan(cancel.indexOf("router.push(cancelHref)"));
  });

  it("attaching a document to an EXISTING setup manages no request key at all", () => {
    expect(CODE).toMatch(/const managed = Boolean\(requestKey && keyScope\)/);
    expect(fn("onCancel")).toMatch(/if \(!managed\) return/);
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

  it("the key is kept ONLY in the tab's session storage (through the store) — never localStorage, a cookie, a URL, a log or analytics", () => {
    const STORE = readFileSync(path.join(ROOT, "src/lib/vehicles/onboarding/onboarding-request-key-store.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const source of [CODE, STORE]) {
      expect(source).not.toMatch(/localStorage|document\.cookie|console\.|gtag|analytics|dataLayer|sendBeacon/);
      expect(source).not.toMatch(/\?requestKey|requestKey=\$\{|searchParams|location\.(href|search|hash)/);
    }
    expect(CODE).not.toMatch(/sessionStorage/); // the form never touches storage directly
    expect(STORE).toMatch(/window\.sessionStorage/);
  });

  it("the explicit 'Add vehicle' entry point, a confirmed cancellation and sign-out each drop the browser's key", () => {
    const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
    expect(read("src/app/[locale]/provider/vehicles/_components/add-vehicle-link.tsx")).toMatch(/onClick=\{\(\) => clearOnboardingRequestKey\(safeSessionStorage\(\)\)\}/);
    const review = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
    expect(review.indexOf("clearOnboardingRequestKey(safeSessionStorage())")).toBeGreaterThan(review.indexOf("await cancelOnboardingAction(vehicleId)"));
    const logout = read("src/components/auth/logout-button.tsx");
    expect(logout.indexOf("clearOnboardingRequestKey(safeSessionStorage())")).toBeLessThan(logout.indexOf("await authClient.signOut()"));
    expect(logout.indexOf("clearOnboardingRequestKey(safeSessionStorage())")).toBeGreaterThan(0);
  });
});

describe("upload copy — complete and honest in all 8 languages", () => {
  const FORM_KEYS = [
    "vehicleOnboardFileLabel", "vehicleOnboardTakePhoto", "vehicleOnboardChooseFile", "vehicleOnboardSelectedFileLabel", "vehicleOnboardNoFileSelected",
    "vehicleOnboardFileHint", "vehicleOnboardPrivacyNote", "vehicleOnboardUploadButton", "vehicleOnboardProcessingImage", "vehicleOnboardUploading",
    "vehicleOnboardErrNetwork", "vehicleOnboardUploadFailed", "vehicleOnboardResumedNotice", "vehicleOnboardManualNotice", "vehicleCancelLabel",
    "vehicleOnboardErrCancelled", "vehicleOnboardErrInProgress", "vehicleOnboardStartNew",
  ];
  const ERROR_KEYS = ASSET_DOCUMENT_ERROR_CODES.map(getAssetDocumentErrorTranslationKey);

  it.each(LOCALES)("%s has every form string and every document error message, none empty", (locale) => {
    const m = messages(locale);
    for (const key of [...FORM_KEYS, ...ERROR_KEYS]) expect(m[key], `${locale}:${key}`).toEqual(expect.stringMatching(/\S/));
  });

  it.each(LOCALES)("%s: BOTH format hints name PDF, JPG and PNG, state the real PDF limit, and do not promise HEIC", (locale) => {
    for (const key of ["vehicleOnboardFileHint", "vehicleOnboardFileHintOcr"]) {
      const hint = messages(locale)[key]!;
      for (const word of ["PDF", "JPG", "PNG"]) expect(hint, key).toContain(word);
      expect(hint, key).toContain(String(MAX_UPLOAD_BYTES / (1024 * 1024))); // "4"
      expect(hint, key).not.toMatch(/HEIC|HEIF/i);
    }
  });

  it("the hint shown depends ONLY on whether automatic reading is operational here — the form never claims more than the server can do", () => {
    expect(CODE).toMatch(/ocrAvailable = false/); // off unless the server says otherwise
    expect(CODE).toMatch(/\{ocrAvailable \? t\("vehicleOnboardFileHintOcr"\) : t\("vehicleOnboardFileHint"\)\}/);
    // The two hints say different things: the default one tells the provider a photo is entered manually.
    const en = messages("en");
    expect(en.vehicleOnboardFileHint).toMatch(/you enter the details yourself/);
    expect(en.vehicleOnboardFileHintOcr).toMatch(/you always review and confirm/);
    expect(en.vehicleOnboardFileHintOcr).not.toBe(en.vehicleOnboardFileHint);
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

  it.each(LOCALES)("%s: no upload string uses internal jargon or names a vendor (the provider is told what happens, not how)", (locale) => {
    const m = messages(locale);
    for (const key of [...FORM_KEYS, ...ERROR_KEYS, "vehicleOnboardFileHintOcr"]) expect(m[key], key).not.toMatch(/\bOCR\b|\bAI\b|Claude|Anthropic/);
  });

  it("the Arabic brand spelling stays correct", () => {
    expect(JSON.stringify(messages("ar"))).not.toContain("بارق");
  });
});
