import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Review / Reject / Resubmit — Admin Provider Detail UI. Proves the
// Reject action (reason input + button) appears for pending applications, is
// absent once REJECTED, and that a REJECTED provider's stored reason is shown.
// The page is an async Server Component called directly and its element tree
// walked for translation keys / hrefs (same convention as the other page tests).

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

// Mutations are wired into inline server actions — not invoked during render.
vi.mock("@/lib/admin/approve-provider", () => ({ approveProvider: vi.fn() }));
vi.mock("@/lib/admin/reject-provider", () => ({ rejectProvider: vi.fn() }));
vi.mock("@/lib/admin/archive-provider", () => ({ archiveProvider: vi.fn() }));
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
  if (typeof node === "object") walk(node.props?.children, texts);
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

async function render(status: string, rejectionReason: string | null = null) {
  getProviderDetailMock.mockResolvedValue(providerDetail(status, rejectionReason));
  const el = await ProviderDetailPage({ params: Promise.resolve({ id: PID }), searchParams: Promise.resolve({}) });
  const texts: string[] = [];
  walk(el, texts);
  return texts;
}

afterEach(() => getProviderDetailMock.mockReset());

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
