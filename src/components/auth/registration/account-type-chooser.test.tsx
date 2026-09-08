import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarCheck, BriefcaseBusiness } from "lucide-react";

// ACCOUNT-TYPE CHOOSER (UI polish) — proves the presentation change is purely visual and does
// NOT touch registration authority: the Book-services card still produces CUSTOMER and the
// Offer-services card still produces PROVIDER via the unchanged setAccountType action. Also
// asserts the two cards use DISTINCT, intended icons (a booking calendar vs a provider
// briefcase) so they're recognizable before the text is read.
//
// The component is a client component with hooks; the project has no @testing-library, so we
// mock the hooks and walk the returned element tree (the same approach as the other component
// tests), invoking a card's onClick to assert the resulting account type.

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, vi.fn()],
    useTransition: () => [false, (fn: () => void) => fn()],
  };
});

const refreshMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const setAccountTypeMock = vi.fn();
vi.mock("@/lib/registration/set-account-type", () => ({
  setAccountType: (...args: unknown[]) => setAccountTypeMock(...args),
}));

vi.mock("@/lib/registration/registration-errors", () => ({
  isRegistrationErrorCode: () => false,
  getRegistrationErrorTranslationKey: (c: string) => c,
}));

const { AccountTypeChooser } = await import("./account-type-chooser");

const labels = {
  customerTitle: "Book services",
  customerDescription: "Find and book services from trusted local providers.",
  providerTitle: "Offer services",
  providerDescription: "List your services and receive bookings from travellers.",
  genericError: "Something went wrong.",
};

// The two <ChooserCard> elements in render order (customer first, provider second). They carry
// `icon`, `title`, and `onClick` props (ChooserCard is not expanded without a renderer).
function cards() {
  const tree = AccountTypeChooser({ labels, errorLabels: {} }) as { props: { children: unknown } };
  const children = (Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]).flat(Infinity);
  return children.filter(
    (c): c is { props: { icon: unknown; title: string; onClick: () => void } } =>
      Boolean(c) && typeof c === "object" && "props" in (c as object) && Boolean((c as { props?: { icon?: unknown } }).props?.icon)
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  setAccountTypeMock.mockReset().mockResolvedValue({ ok: true });
});

describe("AccountTypeChooser", () => {
  it("renders exactly two option cards: Book services (customer) then Offer services (provider)", () => {
    const c = cards();
    expect(c).toHaveLength(2);
    expect(c[0]!.props.title).toBe("Book services");
    expect(c[1]!.props.title).toBe("Offer services");
  });

  it("gives each option a DISTINCT, intended icon (booking calendar vs provider briefcase)", () => {
    const c = cards();
    expect(c[0]!.props.icon).toBe(CalendarCheck);
    expect(c[1]!.props.icon).toBe(BriefcaseBusiness);
    expect(c[0]!.props.icon).not.toBe(c[1]!.props.icon);
  });

  it("choosing 'Book services' still produces CUSTOMER (authority unchanged)", async () => {
    cards()[0]!.props.onClick();
    await Promise.resolve();
    expect(setAccountTypeMock).toHaveBeenCalledTimes(1);
    expect(setAccountTypeMock).toHaveBeenCalledWith("CUSTOMER");
  });

  it("choosing 'Offer services' still produces PROVIDER (authority unchanged)", async () => {
    cards()[1]!.props.onClick();
    await Promise.resolve();
    expect(setAccountTypeMock).toHaveBeenCalledTimes(1);
    expect(setAccountTypeMock).toHaveBeenCalledWith("PROVIDER");
  });
});
