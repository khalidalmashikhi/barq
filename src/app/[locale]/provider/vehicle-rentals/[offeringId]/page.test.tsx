import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => ({ type: "a", props: { href, children } }),
  redirect: (...a: unknown[]) => redirectMock(...a),
}));
const notFoundMock = vi.fn();
vi.mock("next/navigation", () => ({ notFound: (...a: unknown[]) => notFoundMock(...a) }));
vi.mock("@/lib/auth", () => ({ UnauthenticatedError: class extends Error {}, ForbiddenError: class extends Error {} }));

const accessMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  resolveRentalWorkspaceViewAccess: (...a: unknown[]) => accessMock(...a),
}));
const detailMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/get-provider-rental-offering", () => ({
  getProviderRentalOfferingWithDays: (...a: unknown[]) => detailMock(...a),
}));

// Stub the interactive client components so the server page test stays isolated and can assert wiring.
// Named functions so the rendered element's `type.name` identifies them (they are never invoked).
vi.mock("../_components/offering-lifecycle-panel", () => ({ OfferingLifecyclePanel: function OfferingLifecyclePanel() { return null; } }));
vi.mock("../_components/edit-offering-form", () => ({ EditOfferingForm: function EditOfferingForm() { return null; } }));
vi.mock("../_components/availability-calendar", () => ({ AvailabilityCalendar: function AvailabilityCalendar() { return null; } }));

const { default: ProviderRentalOfferingDetailPage } = await import("./page");

type AnyEl = { type: unknown; props?: Record<string, unknown> };
function findByType(el: unknown, typeName: string): AnyEl | null {
  if (!el || typeof el !== "object") return null;
  if (Array.isArray(el)) {
    for (const c of el) { const r = findByType(c, typeName); if (r) return r; }
    return null;
  }
  const e = el as AnyEl;
  if (typeof e.type === "function" && (e.type as { name?: string }).name === typeName) return e;
  return findByType(e.props?.children, typeName);
}
function collectStrings(el: unknown, out: string[]): void {
  if (el == null) return;
  if (typeof el === "string") return void out.push(el);
  if (Array.isArray(el)) return void el.forEach((c) => collectStrings(c, out));
  if (typeof el !== "object") return;
  const e = el as AnyEl;
  for (const key of ["label", "message", "description", "value", "title"]) {
    if (typeof e.props?.[key] === "string") out.push(e.props[key] as string);
  }
  collectStrings(e.props?.children, out);
}
const params = (offeringId: string) => Promise.resolve({ offeringId });

const baseDetail = {
  id: "off-1", serviceId: "svc-1", serviceName: "Van Rental", vehicleId: "veh-1", vehicleTitle: "Toyota Hiace",
  vehicleType: "VAN", vehicleColor: "White", vehicleModelYear: 2029, bookablePassengerCapacity: 6, registeredSeats: 12,
  offeringCapacityOverride: null, effectiveCapacity: 6, baseDailyAmount: "40.00", currency: "OMR", readinessBlocker: null,
  configuredDays: [{ dateKey: "2030-07-10", state: "OPEN", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" }],
  upcomingConfiguredOpenDays: 1, todayKey: "2030-07-01", windowDays: 62,
};

beforeEach(() => {
  detailMock.mockReset();
  notFoundMock.mockReset();
  redirectMock.mockReset();
  accessMock.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" });
});

describe("ProviderRentalOfferingDetailPage (Checkpoint B)", () => {
  it("denies a provider without rental-workspace access via notFound() before reading the offering", async () => {
    accessMock.mockResolvedValue({ ok: false, reason: "NO_RENTAL_ACCESS" });
    const result = await ProviderRentalOfferingDetailPage({ params: params("off-1") });
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a missing/foreign offering", async () => {
    detailMock.mockResolvedValue(null);
    const result = await ProviderRentalOfferingDetailPage({ params: params("off-x") });
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("renders the summary and mounts lifecycle, edit, and the interactive calendar for a DRAFT offering", async () => {
    detailMock.mockResolvedValue({ ...baseDetail, status: "DRAFT" });
    const tree = await ProviderRentalOfferingDetailPage({ params: params("off-1") });
    const texts: string[] = [];
    collectStrings(tree, texts);

    expect(texts).toContain("Toyota Hiace");
    expect(texts).toContain("Van Rental");
    expect(texts).toContain("rentalOfferingStatusDraft");
    expect(texts).toContain("rentalPassengersDoNotChangePrice");

    const lifecycle = findByType(tree, "OfferingLifecyclePanel");
    expect(lifecycle?.props).toMatchObject({ offeringId: "off-1", status: "DRAFT" });

    const edit = findByType(tree, "EditOfferingForm");
    expect(edit?.props).toMatchObject({ offeringId: "off-1", baseDailyAmount: "40.00", currency: "OMR", currencyLocked: false });

    const calendar = findByType(tree, "AvailabilityCalendar");
    expect(calendar?.props).toMatchObject({ offeringId: "off-1", todayKey: "2030-07-01", windowDays: 62, readOnly: false });
    expect((calendar?.props?.configuredDays as unknown[]).length).toBe(1);
  });

  it("locks currency when overrides are present on a draft", async () => {
    detailMock.mockResolvedValue({
      ...baseDetail, status: "DRAFT",
      configuredDays: [{ dateKey: "2030-07-10", state: "OPEN", dailyAmount: "55.00", currency: "OMR", priceSource: "OVERRIDE" }],
    });
    const tree = await ProviderRentalOfferingDetailPage({ params: params("off-1") });
    expect(findByType(tree, "EditOfferingForm")?.props).toMatchObject({ currencyLocked: true });
  });

  it("locks currency for a PUBLISHED offering", async () => {
    detailMock.mockResolvedValue({ ...baseDetail, status: "PUBLISHED" });
    expect(findByType(await ProviderRentalOfferingDetailPage({ params: params("off-1") }), "EditOfferingForm")?.props).toMatchObject({ currencyLocked: true });
  });

  it("an ARCHIVED offering hides the edit form and renders the calendar read-only", async () => {
    detailMock.mockResolvedValue({ ...baseDetail, status: "ARCHIVED" });
    const tree = await ProviderRentalOfferingDetailPage({ params: params("off-1") });
    expect(findByType(tree, "EditOfferingForm")).toBeNull();
    expect(findByType(tree, "AvailabilityCalendar")?.props).toMatchObject({ readOnly: true });
    expect(findByType(tree, "OfferingLifecyclePanel")?.props).toMatchObject({ status: "ARCHIVED" });
  });
});
