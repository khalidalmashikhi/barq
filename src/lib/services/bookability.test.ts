import { describe, it, expect } from "vitest";
import { deriveBookability, isBookable } from "./bookability";

describe("deriveBookability", () => {
  it("is UNAVAILABLE with no active price, regardless of slots", () => {
    expect(deriveBookability({ hasActivePrice: false, requiresSlot: false, hasBookableSlot: false })).toBe("UNAVAILABLE");
    expect(deriveBookability({ hasActivePrice: false, requiresSlot: true, hasBookableSlot: true })).toBe("UNAVAILABLE");
  });

  it("is SLOTLESS_BOOKABLE when priced and not slot-based", () => {
    expect(deriveBookability({ hasActivePrice: true, requiresSlot: false, hasBookableSlot: false })).toBe("SLOTLESS_BOOKABLE");
  });

  it("is BOOKABLE_NOW when slot-based with a bookable slot", () => {
    expect(deriveBookability({ hasActivePrice: true, requiresSlot: true, hasBookableSlot: true })).toBe("BOOKABLE_NOW");
  });

  it("is NO_CURRENT_AVAILABILITY when slot-based with no bookable slot", () => {
    expect(deriveBookability({ hasActivePrice: true, requiresSlot: true, hasBookableSlot: false })).toBe("NO_CURRENT_AVAILABILITY");
  });
});

describe("isBookable", () => {
  it("permits the booking flow only for the two bookable states", () => {
    expect(isBookable("BOOKABLE_NOW")).toBe(true);
    expect(isBookable("SLOTLESS_BOOKABLE")).toBe(true);
    expect(isBookable("NO_CURRENT_AVAILABILITY")).toBe(false);
    expect(isBookable("UNAVAILABLE")).toBe(false);
  });
});
