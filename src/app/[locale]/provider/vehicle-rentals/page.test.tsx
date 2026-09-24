import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
const notFoundMock = vi.fn();
vi.mock("next/navigation", () => ({ notFound: (...a: unknown[]) => notFoundMock(...a) }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => ({ type: "a", props: { href, children } }),
  redirect: (...a: unknown[]) => redirectMock(...a),
}));
vi.mock("@/lib/auth", () => ({ UnauthenticatedError: class extends Error {}, ForbiddenError: class extends Error {} }));

// The shared access gate (its own unit test proves the RENTAL_COMPANY matrix). Here we drive it.
const accessMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  resolveRentalWorkspaceViewAccess: (...a: unknown[]) => accessMock(...a),
}));

const listMock = vi.fn();
const overviewMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/list-provider-rental-offerings", () => ({
  listProviderRentalOfferings: (...a: unknown[]) => listMock(...a),
}));
vi.mock("@/lib/offerings/rental/provider/get-provider-rental-overview", () => ({
  getProviderRentalWorkspaceOverview: (...a: unknown[]) => overviewMock(...a),
}));

const { default: ProviderVehicleRentalsPage } = await import("./page");

// Collect every string that appears as a child OR as a display prop (label/message/description/value)
// — enough to assert on translation keys and read-model content without a DOM.
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

const zeroOverview = {
  totalOfferings: 0, draftOfferings: 0, publishedOfferings: 0, suspendedOfferings: 0,
  vehiclesReadyForRental: 0, vehiclesRequiringVerification: 0, upcomingConfiguredOpenDays: 0,
};

beforeEach(() => {
  listMock.mockReset();
  overviewMock.mockReset();
  notFoundMock.mockReset();
  redirectMock.mockReset();
  accessMock.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" }); // authorized by default
});

describe("ProviderVehicleRentalsPage", () => {
  it("denies a provider without rental-workspace access via notFound() and reads no data", async () => {
    accessMock.mockResolvedValue({ ok: false, reason: "NO_RENTAL_ACCESS" });
    const result = await ProviderVehicleRentalsPage();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    expect(overviewMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated caller to login", async () => {
    accessMock.mockResolvedValue({ ok: false, reason: "UNAUTHENTICATED" });
    await ProviderVehicleRentalsPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/login", locale: "en" });
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders the overview metric labels and an empty-offerings state", async () => {
    overviewMock.mockResolvedValue(zeroOverview);
    listMock.mockResolvedValue([]);

    const tree = await ProviderVehicleRentalsPage();
    const texts: string[] = [];
    collectStrings(tree, texts);

    expect(texts).toContain("rentalWorkspaceTitle");
    expect(texts).toContain("rentalPricedPerVehiclePerDay");
    expect(texts).toContain("rentalOverviewHeading");
    for (const key of [
      "rentalMetricTotalOfferings",
      "rentalMetricDraft",
      "rentalMetricPublished",
      "rentalMetricSuspended",
      "rentalMetricVehiclesReady",
      "rentalMetricVehiclesRequiringVerification",
      "rentalMetricUpcomingConfiguredOpenDays",
    ]) {
      expect(texts).toContain(key);
    }
    // Empty state, not a card list.
    expect(texts).toContain("rentalNoOfferingsLabel");
    expect(texts).toContain("rentalNoOfferingsDescription");
  });

  it("renders an offering card with status, vehicle title, service name, capacity, next-available and a detail link", async () => {
    overviewMock.mockResolvedValue({ ...zeroOverview, totalOfferings: 1, publishedOfferings: 1 });
    listMock.mockResolvedValue([
      {
        id: "off-1", status: "PUBLISHED", serviceId: "svc-1", serviceName: "Desert Safari",
        vehicleId: "veh-1", vehicleTitle: "Toyota Land Cruiser", vehicleType: "SUV",
        bookablePassengerCapacity: 6, offeringCapacityOverride: null, effectiveCapacity: 6,
        baseDailyAmount: "40.00", currency: "OMR", nearestConfiguredOpenDateKey: "2030-07-12", readinessBlocker: null,
      },
    ]);

    const tree = await ProviderVehicleRentalsPage();
    const texts: string[] = [];
    const hrefs: string[] = [];
    collectStrings(tree, texts);
    collectHrefs(tree, hrefs);

    expect(texts).toContain("Desert Safari");
    expect(texts).toContain("Toyota Land Cruiser");
    expect(texts).toContain("rentalOfferingStatusPublished"); // Badge child (status key)
    expect(texts).toContain("rentalMaxPassengersValue"); // capacity line present
    expect(texts).toContain("rentalNextConfiguredOpenLabel"); // nearest-open label present
    expect(texts).not.toContain("rentalNoOfferingsLabel");
    expect(hrefs).toContain("/provider/vehicle-rentals/off-1");
  });

  it("shows a readiness warning and the no-available-days label when applicable", async () => {
    overviewMock.mockResolvedValue({ ...zeroOverview, totalOfferings: 1, draftOfferings: 1 });
    listMock.mockResolvedValue([
      {
        id: "off-2", status: "DRAFT", serviceId: "svc-2", serviceName: "Van hire",
        vehicleId: "veh-2", vehicleTitle: null, vehicleType: null,
        bookablePassengerCapacity: null, offeringCapacityOverride: null, effectiveCapacity: null,
        baseDailyAmount: "10.00", currency: "OMR", nearestConfiguredOpenDateKey: null, readinessBlocker: "VEHICLE_NOT_SELECTABLE",
      },
    ]);

    const tree = await ProviderVehicleRentalsPage();
    const texts: string[] = [];
    collectStrings(tree, texts);

    expect(texts).toContain("rentalVehicleUntitled"); // null title fallback
    expect(texts).toContain("rentalNoConfiguredOpenDaysLabel");
    expect(texts).toContain("rentalBlockerVehicleNotSelectable"); // readiness warning
  });
});
