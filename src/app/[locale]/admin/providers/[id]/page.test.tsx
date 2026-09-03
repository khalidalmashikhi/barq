import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Provider Review / Reject / Resubmit — Admin Provider Detail UI. Proves the
// Reject action (reason input + button) appears for pending applications, is
// absent once REJECTED, and that a REJECTED provider's stored reason is shown.
// The page is an async Server Component called directly and its element tree
// walked for translation keys / hrefs (same convention as the other page tests).
//
// Admin verification review usability fix — also proves the REVIEW-FIRST layout:
// the Verification Documents section renders BEFORE the Provider Actions
// (decision) section, each uploaded document exposes a View action + status, a
// MISSING required requirement is still a visible row, and the provider-level
// Approve is gated behind an approval-readiness affordance (blocker panel +
// disabled Approve while a required doc is unapproved; a "ready" banner + enabled
// Approve once every required doc is APPROVED).

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(),
  Link: (props: Record<string, unknown>) => ({ type: "a", props }),
}));
vi.mock("@/lib/auth", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const getProviderDetailMock = vi.fn();
vi.mock("@/lib/admin/get-provider-detail", () => ({
  getProviderDetail: (...a: unknown[]) => getProviderDetailMock(...a),
}));

// Verification review workspace loaders — mocked so the review-first section and
// the approval-readiness affordance can be driven deterministically.
const getChecklistMock = vi.fn();
vi.mock("@/lib/provider/documents/get-admin-provider-verification-checklist", () => ({
  getAdminProviderVerificationChecklist: (...a: unknown[]) => getChecklistMock(...a),
}));
const assertApprovableMock = vi.fn();
vi.mock("@/lib/provider/documents/assert-provider-approvable", () => ({
  assertProviderApprovable: (...a: unknown[]) => assertApprovableMock(...a),
}));

// Mutations are wired into inline server actions — not invoked during render.
vi.mock("@/lib/admin/approve-provider", () => ({ approveProvider: vi.fn() }));
vi.mock("@/lib/admin/reject-provider", () => ({ rejectProvider: vi.fn() }));
vi.mock("@/lib/admin/archive-provider", () => ({ archiveProvider: vi.fn() }));
vi.mock("@/lib/admin/suspend-provider", () => ({ suspendProvider: vi.fn() }));
vi.mock("@/lib/admin/reactivate-provider", () => ({ reactivateProvider: vi.fn() }));
vi.mock("@/lib/admin/request-provider-changes", () => ({ requestProviderChanges: vi.fn() }));
vi.mock("@/lib/admin/toggle-provider-visibility", () => ({ publishProvider: vi.fn(), unpublishProvider: vi.fn() }));

vi.mock("@/lib/admin/get-audit-events-for-entity", () => ({ getAuditEventsForEntity: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/admin/audit-history", () => ({ AuditHistory: () => null }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: vi.fn().mockResolvedValue((k: string) => k) }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

const { default: ProviderDetailPage } = await import("./page");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: any, texts: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string") {
    texts.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, texts));
    return;
  }
  if (typeof node === "object") {
    // User-visible `title` text (Alert titles, the disabled-Approve hint) lives in
    // props, not children — capture it so those affordances are assertable.
    if (typeof node.props?.title === "string") texts.push(node.props.title);
    walk(node.props?.children, texts);
  }
}

const PID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function providerDetail(status: string, rejectionReason: string | null = null) {
  return {
    id: PID,
    userId: "user-9",
    businessName: { ar: "أكمي", en: "Acme" },
    businessDescription: null,
    slug: null,
    status,
    providerType: "COMPANY",
    visible: false,
    contactEmail: null,
    city: null,
    logoUrl: null,
    approvedAt: null,
    approvedByAdminId: null,
    rejectionReason,
    rejectedAt: rejectionReason ? new Date("2026-08-09T00:00:00Z") : null,
    rejectedByAdminId: rejectionReason ? "admin-1" : null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

function uploadedDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    providerId: PID,
    type: "IDENTITY_PROOF",
    status: "PENDING",
    originalFilename: "civil-id.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    rejectionReason: null,
    reviewedAt: null,
    reviewedByAdminId: null,
    versionToken: "vtok-1",
    createdAt: new Date("2026-08-05T00:00:00Z"),
    updatedAt: new Date("2026-08-05T00:00:00Z"),
    ...overrides,
  };
}

async function render(status: string, rejectionReason: string | null = null) {
  getProviderDetailMock.mockResolvedValue(providerDetail(status, rejectionReason));
  const el = await ProviderDetailPage({ params: Promise.resolve({ id: PID }), searchParams: Promise.resolve({}) });
  const texts: string[] = [];
  walk(el, texts);
  return texts;
}

beforeEach(() => {
  // Default: empty checklist, no blockers — preserves the original Reject-UI tests.
  getChecklistMock.mockResolvedValue({ items: [], requiredTotal: 0, requiredApproved: 0 });
  assertApprovableMock.mockResolvedValue([]);
});

afterEach(() => {
  getProviderDetailMock.mockReset();
  getChecklistMock.mockReset();
  assertApprovableMock.mockReset();
});

describe("ProviderDetailPage — Reject UI", () => {
  it("APPLIED: shows both Approve and Reject (with a reason input)", async () => {
    const texts = await render("APPLIED");
    expect(texts).toContain("approveButton");
    expect(texts).toContain("rejectButton");
    expect(texts).toContain("rejectReasonLabel");
  });

  it("UNDER_REVIEW: shows the Reject action too", async () => {
    const texts = await render("UNDER_REVIEW");
    expect(texts).toContain("rejectButton");
    expect(texts).toContain("rejectReasonLabel");
  });

  it("REJECTED: displays the stored rejection reason, and shows neither Approve nor Reject", async () => {
    const texts = await render("REJECTED", "Please add a valid business licence");
    expect(texts).toContain("providerRejectionReasonLabel");
    expect(texts).toContain("Please add a valid business licence");
    // A rejected application must be resubmitted (→ APPLIED) before a fresh cycle.
    expect(texts).not.toContain("approveButton");
    expect(texts).not.toContain("rejectButton");
  });

  it("APPROVED: shows no Reject action", async () => {
    const texts = await render("APPROVED");
    expect(texts).not.toContain("rejectButton");
    expect(texts).not.toContain("approveButton");
  });
});

describe("ProviderDetailPage — review-first verification workspace", () => {
  it("renders the Verification Documents section BEFORE the Provider Actions (decision) section", async () => {
    const texts = await render("UNDER_REVIEW");
    const docIdx = texts.indexOf("verificationDocumentsTitle");
    const actIdx = texts.indexOf("providerActionsTitle");
    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(actIdx).toBeGreaterThanOrEqual(0);
    // Review comes first: the admin inspects documents before the decision controls.
    expect(docIdx).toBeLessThan(actIdx);
  });

  it("renders an uploaded document with a View action, filename, status and its Approve/Reject controls", async () => {
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: uploadedDoc() }],
      requiredTotal: 1,
      requiredApproved: 0,
    });
    assertApprovableMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "NOT_APPROVED" }]);

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("documentViewButton");
    expect(texts).toContain("civil-id.jpg");
    expect(texts).toContain("documentStatusPending");
    // A PENDING document offers both per-document decisions.
    expect(texts).toContain("documentApproveButton");
    expect(texts).toContain("documentRejectButton");
    expect(texts).toContain("documentRejectReasonLabel");
  });

  it("shows a MISSING required requirement as its own row (not hidden inside the blocker panel)", async () => {
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: null }],
      requiredTotal: 1,
      requiredApproved: 0,
    });
    assertApprovableMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("documentMissingLabel");
    expect(texts).toContain("documentNotUploadedYet");
  });

  it("surfaces a document's rejection reason to the admin when the document is REJECTED", async () => {
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: uploadedDoc({ status: "REJECTED", rejectionReason: "Photo is blurry" }) }],
      requiredTotal: 1,
      requiredApproved: 0,
    });
    assertApprovableMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "NOT_APPROVED" }]);

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("documentRejectionReasonLabel");
    expect(texts).toContain("Photo is blurry");
  });
});

describe("ProviderDetailPage — approval readiness affordance", () => {
  it("BLOCKS approval (blocker panel + disabled Approve) while a required document is not approved", async () => {
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: uploadedDoc() }],
      requiredTotal: 1,
      requiredApproved: 0,
    });
    assertApprovableMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "NOT_APPROVED" }]);

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("approvalBlockedTitle");
    // The disabled Approve carries the explanatory hint as its title.
    expect(texts).toContain("approveDisabledDocumentsHint");
    // The affirmative "ready" banner must NOT be shown while blocked.
    expect(texts).not.toContain("verificationAllRequiredApproved");
  });

  it("shows the affirmative ready banner + an enabled Approve once there are no blockers", async () => {
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: uploadedDoc({ status: "APPROVED" }) }],
      requiredTotal: 1,
      requiredApproved: 1,
    });
    assertApprovableMock.mockResolvedValue([]); // no blockers → ready

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("verificationAllRequiredApproved"); // ready banner
    expect(texts).toContain("approveButton");
    expect(texts).not.toContain("approvalBlockedTitle");
    expect(texts).not.toContain("approveDisabledDocumentsHint");
  });
});

// Admin Provider Review Fail-Closed Integrity gate. State C (a verification read
// threw) must NEVER look like state A (ready): no false "no requirements", no false
// "all approved" ready banner, no enabled Approve — instead an explicit localized
// load-error. Reject stays available (it does not depend on verification data).
describe("ProviderDetailPage — fail-closed on verification read errors", () => {
  it("checklist read FAILS → explicit load-error, never a false 'no requirements' or 'ready'", async () => {
    getChecklistMock.mockRejectedValue(new Error("checklist store down"));
    // The blocker read defaults to [] (beforeEach); the checklist failure ALONE is state C.
    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("verificationLoadErrorTitle");
    expect(texts).toContain("verificationLoadErrorBody");
    // Never a false empty ("no requirements") and never a false ready banner/progress.
    expect(texts).not.toContain("noVerificationRequirements");
    expect(texts).not.toContain("verificationAllRequiredApproved");
    // A failed read is not a normal blocker state either.
    expect(texts).not.toContain("approvalBlockedTitle");
    // Reject does NOT depend on verification data, so it stays available.
    expect(texts).toContain("rejectButton");
  });

  it("blocker read FAILS → approval withheld with explicit error; never collapses to 'no blockers → ready'", async () => {
    // Checklist loads fine (documents still render); only the readiness verdict is unavailable.
    getChecklistMock.mockResolvedValue({
      items: [{ type: "IDENTITY_PROOF", required: true, name: { en: "Identity Proof", ar: "إثبات الهوية" }, description: null, document: uploadedDoc() }],
      requiredTotal: 1,
      requiredApproved: 0,
    });
    assertApprovableMock.mockRejectedValue(new Error("blocker read down"));

    const texts = await render("UNDER_REVIEW");

    expect(texts).toContain("verificationLoadErrorTitle");
    // The empty blocker array from the failed read must NOT be treated as "ready".
    expect(texts).not.toContain("verificationAllRequiredApproved");
    expect(texts).not.toContain("approvalBlockedTitle");
    // The successfully-loaded document is still shown to the admin.
    expect(texts).toContain("documentViewButton");
    expect(texts).toContain("civil-id.jpg");
    expect(texts).toContain("rejectButton");
  });

  it("a checklist read failure withholds readiness even when the blocker read reports approvable", async () => {
    getChecklistMock.mockRejectedValue(new Error("down"));
    assertApprovableMock.mockResolvedValue([]); // would be "ready" ONLY if BOTH reads had succeeded

    const texts = await render("APPLIED");

    expect(texts).toContain("verificationLoadErrorTitle");
    expect(texts).not.toContain("verificationAllRequiredApproved");
  });
});
