import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const experienceFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { experience: { findUnique: (...a: unknown[]) => experienceFindUnique(...a) } },
}));

const { sanitizeGuidingContent, getSanitizedGuidingContent } = await import("./read-guiding-content");

const VALID = {
  version: 1,
  packageType: "GUIDE_WITH_4X4",
  durationMinutes: 300,
  meetingPoint: "Wahiba Sands gate",
  pickup: { included: true, area: "Muscat hotels", hotelPickup: true, airportPickup: false },
  maxGuests: 6,
  languages: ["Arabic", "English"],
  itinerary: [{ title: "Dunes", description: null }],
  includedItems: ["Water"],
  excludedItems: [],
  difficulty: "MODERATE",
  childFriendly: true,
  privateTour: true,
  recommendedEquipment: ["Sunglasses"],
  refreshmentsIncluded: true,
  importantNotes: null,
  vehicle: { type: "FOUR_BY_FOUR", make: "Toyota", model: "Land Cruiser", year: 2022, passengerCapacity: 6 },
};

afterEach(() => experienceFindUnique.mockReset());

describe("sanitizeGuidingContent (fail-closed)", () => {
  it("returns the normalized value for well-formed content", () => {
    const out = sanitizeGuidingContent(VALID);
    expect(out?.packageType).toBe("GUIDE_WITH_4X4");
  });

  it("returns null for absent content", () => {
    expect(sanitizeGuidingContent(null)).toBeNull();
    expect(sanitizeGuidingContent(undefined)).toBeNull();
  });

  it("returns null for MALFORMED historical JSON (never throws, never leaks raw)", () => {
    expect(sanitizeGuidingContent({ version: 1, packageType: "GUIDE_ONLY" })).toBeNull(); // missing fields
    expect(sanitizeGuidingContent({ ...VALID, secretObjectKey: "x" })).toBeNull(); // unknown/private key -> strict reject
    expect(sanitizeGuidingContent("garbage")).toBeNull();
  });
});

describe("getSanitizedGuidingContent", () => {
  it("returns null when there is no Experience row", async () => {
    experienceFindUnique.mockResolvedValue(null);
    expect(await getSanitizedGuidingContent("svc-1")).toBeNull();
  });

  it("returns the sanitized shape for a valid stored value", async () => {
    experienceFindUnique.mockResolvedValue({ guidingContent: VALID });
    const out = await getSanitizedGuidingContent("svc-1");
    expect(out?.vehicle?.type).toBe("FOUR_BY_FOUR");
  });

  it("fails closed to null for a malformed stored value", async () => {
    experienceFindUnique.mockResolvedValue({ guidingContent: { garbage: true } });
    expect(await getSanitizedGuidingContent("svc-1")).toBeNull();
  });
});
