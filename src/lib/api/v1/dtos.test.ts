import { describe, it, expect } from "vitest";
import {
  toServiceSummaryDTO,
  toServiceDetailDTO,
  toProviderPublicDTO,
  toCategoryDTO,
  toAvailabilitySlotDTO,
} from "./dtos";

// These mappers are the no-leak boundary: they copy an allow-list of public
// fields only (never a spread), converting money → MoneyDTO string and Date →
// ISO-8601. Tests assert exact shapes AND the absence of internal fields.

describe("toServiceSummaryDTO", () => {
  it("maps to the public DTO with MoneyDTO amount as a string and ISO date", () => {
    const dto = toServiceSummaryDTO({
      id: "s1",
      name: "Desert Safari",
      providerId: "p1",
      providerName: "Desert Co",
      price: "25 OMR",
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      coverUrl: "https://cdn/x.jpg",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(dto).toEqual({
      id: "s1",
      name: "Desert Safari",
      providerId: "p1",
      providerName: "Desert Co",
      price: { amount: "25.00", currency: "OMR" },
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      coverUrl: "https://cdn/x.jpg",
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    expect(typeof dto.price!.amount).toBe("string");
  });

  it("maps a null price to null", () => {
    const dto = toServiceSummaryDTO({
      id: "s1",
      name: "n",
      providerId: "p1",
      providerName: "pn",
      price: null,
      regionCode: null,
      pricingUnit: null,
      coverUrl: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(dto.price).toBeNull();
  });
});

describe("toServiceDetailDTO", () => {
  it("serializes active prices as MoneyDTO and derives providerVerified", () => {
    const dto = toServiceDetailDTO(
      {
        id: "s1",
        name: "Safari",
        description: "desc",
        providerId: "p1",
        providerName: "Desert Co",
        providerDescription: "pdesc",
        providerStatus: "APPROVED",
        price: "25 OMR",
        regionCode: "DHOFAR",
        pricingUnit: "PER_PERSON",
        coverUrl: "https://cdn/c.jpg",
        gallery: ["https://cdn/g1.jpg"],
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [
        { id: "pr1", amount: "25", currency: "OMR" },
        { id: "pr2", amount: "40.5", currency: "OMR" },
      ],
      { averageRating: 4.5, reviewCount: 3 }
    );
    expect(dto.providerVerified).toBe(true);
    expect(dto.activePrices).toEqual([
      { id: "pr1", price: { amount: "25.00", currency: "OMR" } },
      { id: "pr2", price: { amount: "40.50", currency: "OMR" } },
    ]);
    expect(dto.ratingAverage).toBe(4.5);
    expect(dto.reviewCount).toBe(3);
    expect(dto.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("providerVerified is false for a non-APPROVED status", () => {
    const dto = toServiceDetailDTO(
      {
        id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
        providerDescription: "", providerStatus: "UNDER_REVIEW", price: null,
        regionCode: null, pricingUnit: null, coverUrl: null, gallery: [],
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [],
      { averageRating: null, reviewCount: 0 }
    );
    expect(dto.providerVerified).toBe(false);
    expect(dto.price).toBeNull();
  });
});

describe("toProviderPublicDTO — BR-002 / no-leak", () => {
  it("maps only public fields and never exposes contactEmail or internal fields", () => {
    // Source shaped like ProviderProfile PLUS hostile extra internal fields that
    // must NOT survive the allow-list mapper.
    const source = {
      id: "p1",
      name: "Desert Co",
      description: "d",
      status: "APPROVED",
      providerType: "COMPANY",
      city: "Salalah",
      logoUrl: "https://cdn/logo.jpg",
      coverUrl: "https://cdn/cover.jpg",
      portfolio: ["https://cdn/1.jpg"],
      publishedServicesCount: 4,
      averageRating: 4.2,
      reviewCount: 10,
      categories: [{ id: "c1", slug: "tours", label: "Tours" }],
      // hostile internals (not part of ProviderProfile) — must be dropped:
      contactEmail: "secret@provider.com",
      userId: "u1",
      authUserId: "au1",
    } as never;

    const dto = toProviderPublicDTO(source);
    expect(dto.verified).toBe(true);
    expect(dto.categories).toEqual([{ id: "c1", slug: "tours", label: "Tours" }]);
    const keys = Object.keys(dto);
    expect(keys).not.toContain("contactEmail");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("authUserId");
    expect(JSON.stringify(dto)).not.toContain("secret@provider.com");
  });
});

describe("toCategoryDTO", () => {
  it("maps id/slug/label", () => {
    expect(toCategoryDTO({ id: "c1", slug: "tours", label: "الجولات" })).toEqual({
      id: "c1",
      slug: "tours",
      label: "الجولات",
    });
  });
});

describe("toAvailabilitySlotDTO", () => {
  it("maps with ISO dates and remainingSeats", () => {
    expect(
      toAvailabilitySlotDTO({
        id: "a1",
        startTime: new Date("2026-06-01T09:00:00.000Z"),
        endTime: new Date("2026-06-01T12:00:00.000Z"),
        remainingSeats: 4,
      })
    ).toEqual({
      id: "a1",
      startTime: "2026-06-01T09:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      remainingSeats: 4,
    });
  });
});
