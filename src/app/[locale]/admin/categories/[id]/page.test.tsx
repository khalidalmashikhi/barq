import { describe, it, expect, vi, afterEach } from "vitest";

// UX: the category Details page must show clear "Restore" actions ONLY when the
// category is ARCHIVED, and must hide the Archive action while archived. This
// renders the async Server Component directly (same convention as
// dashboard/page.test.tsx) and walks the returned element tree for the button
// labels — the mocked translator returns each key verbatim.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children?: unknown }) => children,
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const getCategoryDetailMock = vi.fn();
vi.mock("@/lib/categories/get-category-detail", () => ({
  getCategoryDetail: (...args: unknown[]) => getCategoryDetailMock(...args),
}));
vi.mock("@/lib/categories/transition-category-visibility", () => ({
  setCategoryVisibility: vi.fn(),
  archiveCategory: vi.fn(),
  restoreCategory: vi.fn(),
}));
vi.mock("@/lib/categories/reorder-category", () => ({
  moveCategoryUp: vi.fn(),
  moveCategoryDown: vi.fn(),
}));
vi.mock("@/lib/categories/presentation/category-visibility", () => ({
  getCategoryVisibilityStyle: () => "",
  getCategoryVisibilityTranslationKey: (status: string) => `visibility_${status}`,
}));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/uuid", () => ({ isValidUuid: () => true }));
vi.mock("@/lib/categories/category-errors", () => ({
  isCategoryActionErrorCode: () => false,
  getCategoryErrorTranslationKey: (code: string) => code,
}));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children?: unknown }) => children }));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/submit-button", () => ({ SubmitButton: ({ children }: { children?: unknown }) => children }));

const { default: CategoryDetailPage } = await import("./page");

const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

// Collect every string/number leaf reachable through `props.children`.
function collectText(node: unknown, acc: string[]): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, acc);
    return;
  }
  if (typeof node === "object") {
    const el = node as { props?: { children?: unknown } };
    if (el.props && "children" in el.props) collectText(el.props.children, acc);
  }
}

async function renderTexts(
  visibilityStatus: string,
  searchParams: Record<string, string> = {}
): Promise<string[]> {
  getCategoryDetailMock.mockResolvedValue({
    id: CATEGORY_ID,
    name: { ar: "فئة", en: "Cat" },
    slug: "cat",
    serviceTypeKey: "EXPERIENCE",
    parentId: null,
    visibilityStatus,
    scheduledVisibleAt: null,
    children: [],
  });
  const element = await CategoryDetailPage({
    params: Promise.resolve({ id: CATEGORY_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  const texts: string[] = [];
  collectText(element, texts);
  return texts;
}

afterEach(() => {
  getCategoryDetailMock.mockReset();
});

describe("CategoryDetailPage — archived-category restore UX", () => {
  it("ARCHIVED: shows both Restore actions, and hides the Archive + visibility-update controls", async () => {
    const texts = await renderTexts("ARCHIVED");
    expect(texts).toContain("restoreCategoryButton");
    expect(texts).toContain("restoreAsHiddenButton");
    // no competing controls while archived
    expect(texts).not.toContain("archiveCategoryButton");
    expect(texts).not.toContain("setVisibilityButton");
  });

  it("PUBLIC: shows the normal visibility controls + Archive, and no Restore actions", async () => {
    const texts = await renderTexts("PUBLIC");
    expect(texts).toContain("setVisibilityButton");
    expect(texts).toContain("archiveCategoryButton");
    expect(texts).not.toContain("restoreCategoryButton");
    expect(texts).not.toContain("restoreAsHiddenButton");
  });

  it("HIDDEN: shows the normal visibility controls + Archive, and no Restore actions", async () => {
    const texts = await renderTexts("HIDDEN");
    expect(texts).toContain("setVisibilityButton");
    expect(texts).toContain("archiveCategoryButton");
    expect(texts).not.toContain("restoreCategoryButton");
    expect(texts).not.toContain("restoreAsHiddenButton");
  });

  it("shows the success notice after a restore (notice=restored)", async () => {
    const texts = await renderTexts("PUBLIC", { notice: "restored" });
    expect(texts).toContain("categoryRestoredNotice");
  });

  it("does not show the success notice without the notice param", async () => {
    const texts = await renderTexts("PUBLIC");
    expect(texts).not.toContain("categoryRestoredNotice");
  });
});
