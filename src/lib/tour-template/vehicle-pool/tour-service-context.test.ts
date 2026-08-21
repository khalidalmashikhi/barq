import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadOwnedTourServiceContext } from "./tour-service-context";

// A full, strict-contract-valid guidingContent for a transport package (vehicle required).
function validGuidingContent(packageType = "GUIDE_WITH_TRANSPORT", maxGuests: number | null = 6) {
  return {
    version: 1,
    packageType,
    durationMinutes: null,
    meetingPoint: null,
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests,
    languages: [],
    itinerary: [],
    includedItems: [],
    excludedItems: [],
    difficulty: null,
    childFriendly: null,
    privateTour: null,
    recommendedEquipment: [],
    refreshmentsIncluded: null,
    importantNotes: null,
    vehicle: { type: "SUV", make: null, model: null, year: null, passengerCapacity: null },
  };
}

// Minimal db stub — findFirst returns whatever the test wired.
function db(findFirstResult: unknown) {
  return { service: { findFirst: async () => findFirstResult } } as never;
}

describe("loadOwnedTourServiceContext", () => {
  it("SERVICE_NOT_FOUND for a foreign/missing service (uniform)", async () => {
    expect(await loadOwnedTourServiceContext(db(null), "prov-1", "svc-1")).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
  });

  it("TOUR_SERVICE_NOT_ELIGIBLE when the service has no Experience/guidingContent", async () => {
    const noExp = { id: "svc-1", providerId: "prov-1", experience: null };
    expect(await loadOwnedTourServiceContext(db(noExp), "prov-1", "svc-1")).toEqual({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
    const nullGc = { id: "svc-1", providerId: "prov-1", experience: { guidingContent: null } };
    expect(await loadOwnedTourServiceContext(db(nullGc), "prov-1", "svc-1")).toEqual({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
  });

  it("TOUR_SERVICE_NOT_ELIGIBLE when stored guidingContent fails the strict contract (fail-closed)", async () => {
    const bad = { id: "svc-1", providerId: "prov-1", experience: { guidingContent: { version: 1, packageType: "NONSENSE" } } };
    expect(await loadOwnedTourServiceContext(db(bad), "prov-1", "svc-1")).toEqual({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
  });

  it("returns the package + declared maxGuests for a valid tour service", async () => {
    const good = { id: "svc-1", providerId: "prov-1", experience: { guidingContent: validGuidingContent("GUIDE_WITH_TRANSPORT", 8) } };
    expect(await loadOwnedTourServiceContext(db(good), "prov-1", "svc-1")).toEqual({
      ok: true,
      context: { serviceId: "svc-1", providerId: "prov-1", packageType: "GUIDE_WITH_TRANSPORT", maxGuests: 8 },
    });
  });
});
