import { describe, it, expect, vi, afterEach } from "vitest";

// Customer → Provider Journey (B) — the /provider-application status card is
// the single source of truth for application status. These tests confirm the
// per-status guidance, the APPROVED "Open Provider Workspace" handoff CTA, the
// "you remain a customer" reassurance, the neutral suspended/deactivated
// guidance (contact-support link, no invented reason), the page-level
// duplicate-application UX (form hidden once a provider exists), and that
// unauthenticated access still redirects to login. The page is an async Server
// Component called directly and its element tree walked (same convention as
// dashboard/page.test.tsx).

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  UnauthenticatedError,
}));

const providerFindUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { provider: { findUnique: (...a: unknown[]) => providerFindUniqueMock(...a) } },
}));

const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  // Walk-only test: Link is a passthrough that keeps its href/children props.
  Link: (props: Record<string, unknown>) => ({ type: "a", props }),
}));

vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));

const applyAsProviderMock = vi.fn();
vi.mock("@/lib/provider/apply-as-provider", () => ({
  applyAsProvider: (...a: unknown[]) => applyAsProviderMock(...a),
}));

const resubmitMock = vi.fn();
vi.mock("@/lib/provider/resubmit-provider-application", () => ({
  resubmitProviderApplication: (...a: unknown[]) => resubmitMock(...a),
}));

const getSelectableCategoriesMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/categories/get-selectable-categories", () => ({
  getSelectableCategories: (...a: unknown[]) => getSelectableCategoriesMock(...a),
}));
vi.mock("@/components/categories/provider-category-checklist", () => ({
  ProviderCategoryChecklist: () => null,
}));

const { default: ProviderApplicationPage } = await import("./page");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: any, texts: string[], hrefs: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string") {
    texts.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, texts, hrefs));
    return;
  }
  if (typeof node === "object") {
    if (typeof node.props?.href === "string") hrefs.push(node.props.href);
    walk(node.props?.children, texts, hrefs);
  }
}

async function render(status?: string, rejectionReason: string | null = null) {
  providerFindUniqueMock.mockResolvedValue(
    status ? { businessName: { en: "Acme", ar: "أكمي" }, status, rejectionReason } : null
  );
  const el = await ProviderApplicationPage({ searchParams: Promise.resolve({}) });
  const texts: string[] = [];
  const hrefs: string[] = [];
  walk(el, texts, hrefs);
  return { texts, hrefs };
}

afterEach(() => {
  requireAuthMock.mockReset();
  providerFindUniqueMock.mockReset();
  redirectMock.mockReset();
  applyAsProviderMock.mockReset();
  resubmitMock.mockReset();
  getSelectableCategoriesMock.mockClear();
});

describe("ProviderApplicationPage — status UX", () => {
  it("APPLIED: shows the applied guidance and the remain-a-customer note, no workspace CTA", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts, hrefs } = await render("APPLIED");
    expect(texts).toContain("applicationStatusAppliedBody");
    expect(texts).toContain("applicationRemainCustomerNote");
    expect(texts).not.toContain("applicationOpenWorkspaceButton");
    expect(hrefs).not.toContain("/provider");
  });

  it("UNDER_REVIEW: shows its own distinct guidance message", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts } = await render("UNDER_REVIEW");
    expect(texts).toContain("applicationStatusUnderReviewBody");
    expect(texts).toContain("applicationRemainCustomerNote");
  });

  it("APPROVED: shows the success guidance and the Open Provider Workspace CTA (→ /provider)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts, hrefs } = await render("APPROVED");
    expect(texts).toContain("applicationStatusApprovedBody");
    expect(texts).toContain("applicationOpenWorkspaceButton");
    expect(hrefs).toContain("/provider");
    // Still reassured they remain a customer.
    expect(texts).toContain("applicationRemainCustomerNote");
  });

  it("SUSPENDED: neutral guidance + contact-support link (→ /help), no remain-customer note framing", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts, hrefs } = await render("SUSPENDED");
    expect(texts).toContain("applicationStatusSuspendedBody");
    expect(texts).toContain("applicationContactSupportLink");
    expect(hrefs).toContain("/help");
    expect(texts).not.toContain("applicationRemainCustomerNote");
    expect(hrefs).not.toContain("/provider");
  });

  it("DEACTIVATED: neutral guidance + contact-support link", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts, hrefs } = await render("DEACTIVATED");
    expect(texts).toContain("applicationStatusDeactivatedBody");
    expect(texts).toContain("applicationContactSupportLink");
    expect(hrefs).toContain("/help");
  });

  it("REJECTED: shows the rejection reason, the Resubmit action, and a link to fix the profile (→ /provider/settings)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts, hrefs } = await render("REJECTED", "Please add a valid business licence");
    expect(texts).toContain("applicationStatusRejectedBody");
    // the current reason is displayed verbatim
    expect(texts).toContain("Please add a valid business licence");
    expect(texts).toContain("applicationRejectionReasonLabel");
    // resubmit + correction path (reuses existing Provider Settings, not a form here)
    expect(texts).toContain("applicationResubmitButton");
    expect(texts).toContain("applicationFixProfileLink");
    expect(hrefs).toContain("/provider/settings");
    // still reassured they remain a customer; not a workspace CTA
    expect(texts).toContain("applicationRemainCustomerNote");
    expect(hrefs).not.toContain("/provider");
    // does not render the fresh-application form
    expect(texts).not.toContain("applicationSubmitButton");
  });

  it("REJECTED with no stored reason: still renders Resubmit without a reason box", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts } = await render("REJECTED", null);
    expect(texts).toContain("applicationResubmitButton");
    expect(texts).not.toContain("applicationRejectionReasonLabel");
  });

  it("no provider yet: renders the application form (duplicate not yet possible)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts } = await render(undefined);
    expect(texts).toContain("applicationSubmitButton");
    expect(getSelectableCategoriesMock).toHaveBeenCalled();
  });

  it("existing provider: hides the application form (page-level duplicate-application UX)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    const { texts } = await render("APPLIED");
    // The submit button belongs to the form branch only — it must be absent
    // once a provider row exists, so a user can never file a second application.
    expect(texts).not.toContain("applicationSubmitButton");
    expect(getSelectableCategoriesMock).not.toHaveBeenCalled();
  });

  it("unauthenticated: redirects to login", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    const el = await ProviderApplicationPage({ searchParams: Promise.resolve({}) });
    expect(el).toBeNull();
    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: "/login" }));
  });
});
