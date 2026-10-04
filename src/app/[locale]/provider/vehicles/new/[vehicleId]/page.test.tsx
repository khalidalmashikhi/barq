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
vi.mock("../_components/registration-upload-form", () => ({ RegistrationUploadForm: function RegistrationUploadForm() { return null; } }));
vi.mock("@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button", () => ({ AnalyzeRegistrationButton: function AnalyzeRegistrationButton() { return null; } }));

const { default: OnboardingReviewPage } = await import("./page");
const { OnboardingReviewForm } = await import("./_components/onboarding-review-form");
const { RegistrationUploadForm } = await import("../_components/registration-upload-form");

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
const field = (key: string, extractedValue: string | number | null) => ({ key, group: "CUSTOMER", kind: "text", sensitive: false, required: true, extractedValue, confidence: extractedValue === null ? null : "HIGH", confirmedValue: null, decision: null });
const review = (over: Record<string, unknown> = {}) => ({
  vehicleId: VEH,
  documentId: "doc-1",
  documentStatus: "PENDING",
  documentFilename: "reg.pdf",
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
    expect(forms[0]!.props).toMatchObject({ vehicleId: VEH, isManual: false, suggestedVehicleType: "FOUR_BY_FOUR" });
    expect((forms[0]!.props.fields as unknown[]).length).toBe(3);
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });

  it("image / scanned PDF (extraction FAILED) → honest MANUAL review: no suggestion is invented", async () => {
    getRegistrationReviewMock.mockResolvedValue(
      review({ reviewState: { extraction: "FAILED", confirmation: "NONE", canAnalyze: true, canConfirm: true, locked: false, failureLabelKey: "vehicleRegFailNoText" }, fields: [field("make", null), field("model", null)] }),
    );
    const el = await OnboardingReviewPage(call());
    const form = findAll(el, (e) => e.type === OnboardingReviewForm)[0]!;
    expect(form.props).toMatchObject({ isManual: true, suggestedVehicleType: null });
    expect((form.props.fields as { extractedValue: unknown }[]).every((f) => f.extractedValue === null)).toBe(true);
  });

  it("a shell with NO registration document → the document step again (never a blank details form)", async () => {
    getRegistrationReviewMock.mockResolvedValue(review({ documentId: null, fields: [] }));
    const el = await OnboardingReviewPage(call({ docError: "TOO_LARGE" }));
    expect(findAll(el, (e) => e.type === OnboardingReviewForm)).toHaveLength(0);
    const upload = findAll(el, (e) => e.type === RegistrationUploadForm);
    expect(upload).toHaveLength(1);
    expect(upload[0]!.props).toMatchObject({ action: `/api/provider/vehicles/${VEH}/documents`, hiddenFields: { type: "VEHICLE_REGISTRATION" } });
    const text = strings(el);
    expect(text).toContain("vehicleOnboardMissingDocument");
    expect(text).toContain("vehicleDocErrorTooLarge");
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
