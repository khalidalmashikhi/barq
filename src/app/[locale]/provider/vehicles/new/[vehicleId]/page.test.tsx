import { describe, it, expect, vi, beforeEach } from "vitest";

// Wizard step 2 — review & confirm. Selected by the general vehicle authority + ownership (never the
// rental predicate); a native-text PDF shows extracted suggestions, an image/scan goes to an HONEST
// manual review, and a shell with no document goes back to the document step (never a blank form).

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
const rentalPredicateMock = vi.fn(() => {
  throw new Error("the review step must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "ar" }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props, redirect: (...a: unknown[]) => redirectMock(...a) }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
const getRegistrationReviewMock = vi.fn();
vi.mock("@/lib/vehicles/registration-review/get-registration-review", () => ({ getRegistrationReview: (...a: unknown[]) => getRegistrationReviewMock(...a) }));
vi.mock("./_components/onboarding-review-form", () => ({ OnboardingReviewForm: function OnboardingReviewForm() { return null; } }));
vi.mock("./_components/extraction-progress", () => ({ ExtractionProgress: function ExtractionProgress() { return null; } }));
vi.mock("./_components/ocr-consent-step", () => ({ OcrConsentStep: function OcrConsentStep() { return null; } }));
const ocrOperationalMock = vi.fn(() => false);
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => ({ isRegistrationOcrOperational: () => ocrOperationalMock() }));
vi.mock("../_components/registration-upload-form", () => ({ RegistrationUploadForm: function RegistrationUploadForm() { return null; } }));
vi.mock("@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button", () => ({ AnalyzeRegistrationButton: function AnalyzeRegistrationButton() { return null; } }));

const { default: OnboardingReviewPage } = await import("./page");
const { OnboardingReviewForm } = await import("./_components/onboarding-review-form");
const { RegistrationUploadForm } = await import("../_components/registration-upload-form");
const { ExtractionProgress } = await import("./_components/extraction-progress");
const { OcrConsentStep } = await import("./_components/ocr-consent-step");
const { AnalyzeRegistrationButton } = await import("@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function findAll(el: unknown, pred: (e: AnyEl) => boolean, acc: AnyEl[] = []): AnyEl[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => findAll(c, pred, acc)), acc;
  const e = el as AnyEl;
  if (e.props && pred(e)) acc.push(e);
  findAll(e.props?.children, pred, acc);
  return acc;
}
function strings(el: unknown, acc: string[] = []): string[] {
  if (typeof el === "string") return acc.push(el), acc;
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => strings(c, acc)), acc;
  for (const v of Object.values((el as AnyEl).props ?? {})) strings(v, acc);
  return acc;
}

const VEH = "11111111-1111-1111-1111-111111111111";
const call = (sp: Record<string, string> = {}) => ({ params: Promise.resolve({ vehicleId: VEH }), searchParams: Promise.resolve(sp) });
const field = (key: string, extractedValue: string | number | null) => ({ key, group: "CUSTOMER", kind: "text", sensitive: false, required: true, extractedValue, confidence: extractedValue === null ? null : "HIGH", confirmedValue: null, decision: null, source: extractedValue === null ? "UNRESOLVED" : "NATIVE_PDF_TEXT", needsReview: extractedValue === null });
/** The stored SET as the read model reports it: derived from the (legacy) single-document fields
 *  unless a test supplies `pages` / `setKind` itself. */
function withPages(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  if (!("pages" in out)) out.pages = out.documentId ? [{ documentId: out.documentId, role: "FRONT", mimeType: out.documentMimeType ?? "application/pdf", filename: out.documentFilename ?? null, sizeBytes: 1234 }] : [];
  if (!("setKind" in out)) out.setKind = !out.documentId ? null : out.documentMimeType === "application/pdf" ? "PDF" : (out.pages as unknown[]).length === 2 ? "IMAGES" : "IMAGE";
  return out;
}
const review = (over: Record<string, unknown> = {}) => withPages({
  vehicleId: VEH,
  documentId: "doc-1",
  documentStatus: "PENDING",
  documentFilename: "reg.pdf",
  documentMimeType: "application/pdf",
  extractionSource: "NATIVE_PDF_TEXT",
  ocrConsent: null,
  reviewState: { extraction: "EXTRACTED", confirmation: "NONE", canAnalyze: false, canConfirm: true, locked: false, failureLabelKey: null },
  lastAttemptedAt: null,
  lastSucceededAt: null,
  confirmation: null,
  fields: [field("make", "Toyota"), field("model", "Land Cruiser 4x4"), field("usageClassification", null)],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u" }, provider: { id: "guide", status: "APPROVED" } });
  getRegistrationReviewMock.mockResolvedValue(review());
});

describe("OnboardingReviewPage", () => {
  it("native-text PDF → the review form with extracted suggestions, NOT flagged manual; no rental predicate", async () => {
    const el = await OnboardingReviewPage(call());
    const forms = findAll(el, (e) => e.type === OnboardingReviewForm);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.props).toMatchObject({ vehicleId: VEH, noticeKey: null, suggestedVehicleType: "FOUR_BY_FOUR" }); // read from native text: no manual/OCR notice
    expect((forms[0]!.props.fields as unknown[]).length).toBe(3);
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });

  it("image / scanned PDF (extraction FAILED) → honest MANUAL review: no suggestion is invented", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ extractionSource: null, reviewState: { extraction: "FAILED", confirmation: "NONE", canAnalyze: true, canConfirm: true, locked: false, failureLabelKey: "vehicleRegFailNoText" }, fields: [field("make", null), field("model", null)] }),
    );
    const el = await OnboardingReviewPage(call());
    const form = findAll(el, (e) => e.type === OnboardingReviewForm)[0]!;
    // The precise (localized) failure reason is what the provider sees — and manual entry is open.
    expect(form.props).toMatchObject({ noticeKey: "vehicleRegFailNoText", noticeVariant: "warning", suggestedVehicleType: null });
    expect((form.props.fields as { extractedValue: unknown }[]).every((f) => f.extractedValue === null)).toBe(true);
  });

  it("a shell with NO registration document → the document step again (never a blank details form)", async () => {
    getRegistrationReviewMock.mockResolvedValue(review({ documentId: null, fields: [] }));
    const el = await OnboardingReviewPage(call({ docError: "TOO_LARGE" }));
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)).toHaveLength(0);
    const upload = findAll(el, (e) => e.type === RegistrationUploadForm);
    expect(upload).toHaveLength(1);
    expect(upload[0]!.props).toMatchObject({ action: `/api/provider/vehicles/${VEH}/documents`, hiddenFields: { type: "VEHICLE_REGISTRATION" }, successHref: `/provider/vehicles/new/${VEH}` });
    // Attaching to an EXISTING setup creates nothing new, so it carries no onboarding request key.
    expect(upload[0]!.props.requestKey).toBeUndefined();
    const text = strings(el);
    expect(text).toContain("vehicleOnboardMissingDocument");
    expect(text).toContain("vehicleDocErrorTooLarge");
  });

  it("a replayed upload (?resumed=1) is told it is continuing the SAME setup; a normal visit is not", async () => {
    expect(strings(await OnboardingReviewPage(call({ resumed: "1" })))).toContain("vehicleOnboardResumedNotice");
    expect(strings(await OnboardingReviewPage(call()))).not.toContain("vehicleOnboardResumedNotice");
    expect(strings(await OnboardingReviewPage(call({ resumed: "yes" })))).not.toContain("vehicleOnboardResumedNotice");
  });

  it("a PHOTO read by OCR → the review form with the OCR caution, and an inline preview served by the owner-checked view route", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({
        documentMimeType: "image/jpeg",
        extractionSource: "OCR",
        reviewState: { extraction: "NEEDS_REVIEW", confirmation: "NONE", canAnalyze: false, canConfirm: true, locked: false, failureLabelKey: null },
        fields: [{ ...field("make", "Toyota"), source: "OCR", needsReview: true, confidence: "MEDIUM" }],
      }),
    );
    const el = await OnboardingReviewPage(call());
    const form = findAll(el, (e) => e.type === OnboardingReviewForm)[0]!;
    expect(form.props).toMatchObject({ noticeKey: "vehicleOnboardOcrNotice", noticeVariant: "info" });
    const fields = form.props.fields as { source: string; needsReview: boolean }[];
    expect(fields[0]).toMatchObject({ source: "OCR", needsReview: true }); // the form is told what was read automatically
    const previews = findAll(el, (e) => e.type === "img");
    expect(previews).toHaveLength(1);
    expect(previews[0]!.props).toMatchObject({ src: `/api/provider/vehicles/${VEH}/documents/doc-1/view`, alt: "vehicleOnboardPreviewAlt", referrerPolicy: "no-referrer" });
    expect(String(previews[0]!.props.src)).not.toMatch(/asset-documents|supabase|https?:/); // never a storage key or a public URL
  });

  it("a PDF document shows the view link only — no inline image", async () => {
    const el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === "img")).toHaveLength(0);
    expect(findAll(el, (e) => e.type === "a" && e.props.href === `/api/provider/vehicles/${VEH}/documents/doc-1/view`)).toHaveLength(1);
  });

  it("while the document is BEING READ: a progress notice, NO form and NO analyze button (never a second reading, never a half-filled form)", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ documentMimeType: "image/jpeg", extractionSource: null, reviewState: { extraction: "PROCESSING", confirmation: "NONE", canAnalyze: false, canConfirm: false, locked: false, failureLabelKey: null }, fields: [field("make", null)] }),
    );
    const el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === ExtractionProgress)).toHaveLength(1);
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)).toHaveLength(0);
    expect(findAll(el, (e) => e.type === AnalyzeRegistrationButton)).toHaveLength(0);
    expect(strings(el)).toContain("vehicleRegStateProcessing");
  });

  it.each([
    ["OCR unavailable", "vehicleRegExtractFailOcrUnavailable"],
    ["OCR timed out", "vehicleRegExtractFailOcrTimeout"],
    ["nothing readable", "vehicleRegExtractFailOcrUnreadable"],
  ])("extraction failure (%s): the document is kept, the reason is shown, RETRY and MANUAL ENTRY are both offered", async (_label, labelKey) => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ documentMimeType: "image/jpeg", extractionSource: null, reviewState: { extraction: "FAILED", confirmation: "NONE", canAnalyze: true, canConfirm: true, locked: false, failureLabelKey: labelKey }, fields: [field("make", null)] }),
    );
    const el = await OnboardingReviewPage(call());
    const form = findAll(el, (e) => e.type === OnboardingReviewForm);
    expect(form).toHaveLength(1); // manual entry on the SAME shell
    expect(form[0]!.props).toMatchObject({ vehicleId: VEH, noticeKey: labelKey, noticeVariant: "warning" });
    const retry = findAll(el, (e) => e.type === AnalyzeRegistrationButton);
    expect(retry).toHaveLength(1);
    expect(retry[0]!.props).toMatchObject({ vehicleId: VEH, retry: true });
    expect(findAll(el, (e) => e.type === "img")).toHaveLength(1); // the uploaded document is still there
  });

  it("no reading yet (never analyzed) → the generic manual notice", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ extractionSource: null, reviewState: { extraction: "NOT_ANALYZED", confirmation: "NONE", canAnalyze: true, canConfirm: false, locked: false, failureLabelKey: null }, fields: [field("make", null)] }),
    );
    const form = findAll(await OnboardingReviewPage(call()), (e) => e.type === OnboardingReviewForm)[0]!;
    expect(form.props).toMatchObject({ noticeKey: "vehicleOnboardManualNotice", noticeVariant: "info" });
  });

  it("an already-confirmed vehicle leaves the wizard for its detail page", async () => {
    getRegistrationReviewMock.mockResolvedValue(review({ confirmation: { status: "SUBMITTED", submittedAt: new Date() } }));
    await OnboardingReviewPage(call());
    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: `/provider/vehicles/${VEH}` }));
  });

  it("a foreign / missing vehicle is non-enumerating (notFound)", async () => {
    getRegistrationReviewMock.mockResolvedValue(null);
    await expect(OnboardingReviewPage(call())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a provider that is not approved gets notFound before any vehicle lookup", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no"));
    await expect(OnboardingReviewPage(call())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getRegistrationReviewMock).not.toHaveBeenCalled();
  });
});

describe("OnboardingReviewPage — the OCR privacy gate (consent step)", () => {
  const AWAITING = { extraction: "AWAITING_CONSENT", confirmation: "NONE", canAnalyze: false, canConfirm: true, locked: false, failureLabelKey: null };
  const consent = (state: "NONE" | "DECLINED" | "STALE" | "GRANTED") => ({ state, policyVersion: "2026-10-v1", processor: "anthropic", inferenceGeo: "us" });
  const photo = (state: "NONE" | "DECLINED" | "STALE", over: Record<string, unknown> = {}) =>
    review({ documentMimeType: "image/jpeg", extractionSource: null, ocrConsent: consent(state), reviewState: AWAITING, fields: [field("make", null), field("model", null)], ...over });

  it("photo awaiting the provider's choice → the standalone consent step, NO form, NO retry button, nothing read", async () => {
    getRegistrationReviewMock.mockResolvedValue(photo("NONE"));
    const el = await OnboardingReviewPage(call());
    const steps = findAll(el, (e) => e.type === OcrConsentStep);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.props).toEqual({ vehicleId: VEH, mode: "choose", inferenceGeo: "us", setKind: "IMAGE" }); // the notice names what would be sent
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)).toHaveLength(0);
    expect(findAll(el, (e) => e.type === AnalyzeRegistrationButton)).toHaveLength(0);
    expect(findAll(el, (e) => e.type === ExtractionProgress)).toHaveLength(0);
    expect(strings(el)).toContain("vehicleRegStateAwaitingChoice");
  });

  it("the notice changed since the last consent → the step in 'stale' mode (asked again)", async () => {
    getRegistrationReviewMock.mockResolvedValue(photo("STALE"));
    const el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === OcrConsentStep)[0]!.props).toMatchObject({ mode: "stale" });
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)).toHaveLength(0);
  });

  it("DECLINED → manual entry is available: the review form with the 'you chose manual' notice, plus the compact step to change one's mind", async () => {
    getRegistrationReviewMock.mockResolvedValue(photo("DECLINED"));
    const el = await OnboardingReviewPage(call());
    const form = findAll(el, (e) => e.type === OnboardingReviewForm);
    expect(form).toHaveLength(1);
    expect(form[0]!.props).toMatchObject({ noticeKey: "vehicleRegConsentDeclinedNotice", noticeVariant: "info" });
    expect((form[0]!.props.fields as { extractedValue: unknown }[]).every((f) => f.extractedValue === null)).toBe(true); // nothing invented
    const step = findAll(el, (e) => e.type === OcrConsentStep);
    expect(step).toHaveLength(1);
    expect(step[0]!.props).toMatchObject({ mode: "declined" });
  });

  it("automatic reading switched off (no consent facts) → never a consent step; the honest manual review as before", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ documentMimeType: "image/jpeg", extractionSource: null, ocrConsent: null, reviewState: { extraction: "FAILED", confirmation: "NONE", canAnalyze: true, canConfirm: true, locked: false, failureLabelKey: "vehicleRegExtractFailOcrUnavailable" }, fields: [field("make", null)] }),
    );
    const el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === OcrConsentStep)).toHaveLength(0);
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)[0]!.props).toMatchObject({ noticeKey: "vehicleRegExtractFailOcrUnavailable", noticeVariant: "warning" });
  });

  it("the passage from consent to suggestions: GRANTED + reading in flight → the progress wait; GRANTED + read → the OCR-caution form", async () => {
    getRegistrationReviewMock.mockResolvedValue(photo("NONE", { ocrConsent: consent("GRANTED"), reviewState: { ...AWAITING, extraction: "PROCESSING", canConfirm: false } }));
    let el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === ExtractionProgress)).toHaveLength(1);
    expect(findAll(el, (e) => e.type === OcrConsentStep)).toHaveLength(0);
    getRegistrationReviewMock.mockResolvedValue(photo("NONE", { ocrConsent: consent("GRANTED"), extractionSource: "OCR", reviewState: { ...AWAITING, extraction: "NEEDS_REVIEW" }, fields: [{ ...field("make", "Toyota"), source: "OCR", confidence: "MEDIUM", needsReview: true }] }));
    el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)[0]!.props).toMatchObject({ noticeKey: "vehicleOnboardOcrNotice" });
    expect(findAll(el, (e) => e.type === OcrConsentStep)).toHaveLength(0);
  });
});

describe("OnboardingReviewPage — the registration document SET", () => {
  const twoPages = [
    { documentId: "doc-1", role: "FRONT", mimeType: "image/jpeg", filename: "front.jpg", sizeBytes: 1000 },
    { documentId: "doc-2", role: "BACK", mimeType: "image/jpeg", filename: "back.jpg", sizeBytes: 2000 },
  ];
  const consent = { state: "NONE", policyVersion: "v1", processor: "anthropic", inferenceGeo: "us" };
  const awaiting = { extraction: "AWAITING_CONSENT", confirmation: "NONE", canAnalyze: false, canConfirm: false, locked: false, failureLabelKey: null };

  it("front + back photos → BOTH sides previewed, front first, each through the owner-checked view route; the summary says two photos", async () => {
    getRegistrationReviewMock.mockResolvedValue(review({ documentMimeType: "image/jpeg", pages: twoPages, setKind: "IMAGES", extractionSource: "OCR", reviewState: { extraction: "NEEDS_REVIEW", confirmation: "NONE", canAnalyze: false, canConfirm: true, locked: false, failureLabelKey: null } }));
    const el = await OnboardingReviewPage(call());
    const imgs = findAll(el, (e) => e.type === "img");
    expect(imgs.map((i) => i.props.src)).toEqual([`/api/provider/vehicles/${VEH}/documents/doc-1/view`, `/api/provider/vehicles/${VEH}/documents/doc-2/view`]);
    expect(imgs.map((i) => i.props.alt)).toEqual(["vehicleOnboardPreviewAlt", "vehicleOnboardBackPreviewAlt"]);
    const text = strings(el);
    expect(text).toContain("vehicleOnboardSetSummaryImages");
    expect(text).toContain("vehicleRegPageFront");
    expect(text).toContain("vehicleRegPageBack");
    expect(findAll(el, (e) => e.type === "a" && String(e.props.href).endsWith("/view"))).toHaveLength(2);
  });

  it("a PDF → no inline image; a safe open link with the file's name and size; the summary says one PDF", async () => {
    const el = await OnboardingReviewPage(call());
    expect(findAll(el, (e) => e.type === "img")).toHaveLength(0);
    expect(findAll(el, (e) => e.type === "a" && e.props.href === `/api/provider/vehicles/${VEH}/documents/doc-1/view`)).toHaveLength(1);
    const text = strings(el);
    expect(text).toContain("vehicleOnboardSetSummaryPdf");
    expect(text).toContain("vehicleRegPagePdf");
    expect(text).toContain("reg.pdf");
    expect(text.join(" ")).not.toMatch(/asset-documents|supabase/);
  });

  it("the consent step is told WHAT would be sent: all photos together for a two-photo set, the PDF for a PDF", async () => {
    getRegistrationReviewMock.mockResolvedValue(review({ documentMimeType: "image/jpeg", pages: twoPages, setKind: "IMAGES", extractionSource: null, ocrConsent: consent, reviewState: awaiting, fields: [field("make", null)] }));
    let step = findAll(await OnboardingReviewPage(call()), (e) => e.type === OcrConsentStep);
    expect(step).toHaveLength(1);
    expect(step[0]!.props).toMatchObject({ mode: "choose", setKind: "IMAGES", inferenceGeo: "us" });
    getRegistrationReviewMock.mockResolvedValue(review({ extractionSource: null, ocrConsent: consent, reviewState: awaiting, fields: [field("make", null)] }));
    step = findAll(await OnboardingReviewPage(call()), (e) => e.type === OcrConsentStep);
    expect(step[0]!.props).toMatchObject({ setKind: "PDF" });
    expect(findAll(await OnboardingReviewPage(call()), (e) => e.type === OnboardingReviewForm)).toHaveLength(0); // nothing to fill before the choice
  });

  it("a field the document showed with two different values reaches the form UNRESOLVED with its alternatives, flagged for review", async () => {
    const conflicting = { ...field("modelYear", null), conflict: true, alternatives: [2019, 2020], needsReview: true, source: "UNRESOLVED" };
    getRegistrationReviewMock.mockResolvedValue(review({ documentMimeType: "image/jpeg", pages: twoPages, setKind: "IMAGES", extractionSource: "OCR", reviewState: { extraction: "NEEDS_REVIEW", confirmation: "NONE", canAnalyze: false, canConfirm: true, locked: false, failureLabelKey: null }, fields: [conflicting] }));
    const form = findAll(await OnboardingReviewPage(call()), (e) => e.type === OnboardingReviewForm)[0]!;
    expect((form.props.fields as unknown[])[0]).toMatchObject({ key: "modelYear", extractedValue: null, conflict: true, alternatives: [2019, 2020], needsReview: true });
  });
});
