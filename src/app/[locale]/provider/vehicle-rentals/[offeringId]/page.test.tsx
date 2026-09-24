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

const { default: ProviderRentalOfferingDetailPage } = await import("./page");

function collectStrings(el: unknown, out: string[]): void {
  if (el == null) return;
  if (typeof el === "string") return void out.push(el);
  if (Array.isArray(el)) return void el.forEach((c) => collectStrings(c, out));
  if (typeof el !== "object") return;
  const e = el as { props?: Record<string, unknown> };
  for (const key of ["label", "message", "description", "value", "title"]) {
    if (typeof e.props?.[key] === "string") out.push(e.props[key] as string);
  }
  collectStrings(e.props?.children, out);
}
function collectHrefs(el: unknown, out: string[]): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return void el.forEach((c) => collectHrefs(c, out));
  const e = el as { props?: Record<string, unknown> };
  if (typeof e.props?.href === "string") out.push(e.props.href as string);
  collectHrefs(e.props?.children, out);
}
const params = (offeringId: string) => Promise.resolve({ offeringId });

beforeEach(() => {
  detailMock.mockReset();
  notFoundMock.mockReset();
  redirectMock.mockReset();
  accessMock.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" }); // authorized by default
});

describe("ProviderRentalOfferingDetailPage", () => {
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

  it("renders identity, commercial summary, and each configured day with its state + price source", async () => {
    detailMock.mockResolvedValue({
      id: "off-1", status: "PUBLISHED", serviceId: "svc-1", serviceName: "Van Rental",
      vehicleId: "veh-1", vehicleTitle: "Toyota Hiace", vehicleType: "VAN", vehicleColor: "White", vehicleModelYear: 2029,
      bookablePassengerCapacity: 6, registeredSeats: 12, offeringCapacityOverride: null, effectiveCapacity: 6,
      baseDailyAmount: "40.00", currency: "OMR", readinessBlocker: null,
      upcomingConfiguredOpenDays: 2,
      configuredDays: [
        { dateKey: "2030-07-10", state: "OPEN", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" },
        { dateKey: "2030-07-15", state: "BLOCKED", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" },
        { dateKey: "2030-07-20", state: "OPEN", dailyAmount: "55.00", currency: "OMR", priceSource: "OVERRIDE" },
      ],
    });

    const tree = await ProviderRentalOfferingDetailPage({ params: params("off-1") });
    const texts: string[] = [];
    const hrefs: string[] = [];
    collectStrings(tree, texts);
    collectHrefs(tree, hrefs);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(texts).toContain("Toyota Hiace");
    expect(texts).toContain("Van Rental");
    expect(texts).toContain("rentalOfferingStatusPublished");
    expect(texts).toContain("rentalBasePriceLabel");
    expect(texts).toContain("rentalRegisteredSeatsLabel");
    expect(texts).toContain("rentalPassengersDoNotChangePrice");
    expect(texts).toContain("rentalConfiguredDaysHeading");
    // Day states + price sources both present (text, never color alone).
    expect(texts).toContain("rentalDayStateOpen");
    expect(texts).toContain("rentalDayStateBlocked");
    expect(texts).toContain("rentalPriceSourceBase");
    expect(texts).toContain("rentalPriceSourceOverride");
    // Back link to the workspace root.
    expect(hrefs).toContain("/provider/vehicle-rentals");
  });

  it("shows an empty configured-days state when none exist", async () => {
    detailMock.mockResolvedValue({
      id: "off-2", status: "DRAFT", serviceId: "s", serviceName: "X",
      vehicleId: "v", vehicleTitle: "Car", vehicleType: null, vehicleColor: null, vehicleModelYear: null,
      bookablePassengerCapacity: 4, registeredSeats: null, offeringCapacityOverride: null, effectiveCapacity: 4,
      baseDailyAmount: "10.00", currency: "OMR", readinessBlocker: null, upcomingConfiguredOpenDays: 0, configuredDays: [],
    });
    const tree = await ProviderRentalOfferingDetailPage({ params: params("off-2") });
    const texts: string[] = [];
    collectStrings(tree, texts);
    expect(texts).toContain("rentalNoConfiguredDaysLabel");
    expect(texts).not.toContain("rentalRegisteredSeatsLabel"); // registeredSeats null → row omitted
  });
});
