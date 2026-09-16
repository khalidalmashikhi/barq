import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeRentalHoldRequestFingerprint,
  computeRentalHoldQuoteFingerprint,
  RENTAL_HOLD_TTL_MINUTES,
  MAX_RENTAL_HOLD_DATES,
} from "./reservation-types";

describe("rental hold fingerprints", () => {
  it("request fingerprint is deterministic and independent of date order (caller pre-sorts)", () => {
    const a = computeRentalHoldRequestFingerprint({ offeringId: "o1", dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 2 });
    const b = computeRentalHoldRequestFingerprint({ offeringId: "o1", dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 2 });
    expect(a).toBe(b);
  });
  it("request fingerprint changes with offering, dates, or passenger count", () => {
    const base = computeRentalHoldRequestFingerprint({ offeringId: "o1", dateKeys: ["2030-07-10"], passengerCount: 2 });
    expect(computeRentalHoldRequestFingerprint({ offeringId: "o2", dateKeys: ["2030-07-10"], passengerCount: 2 })).not.toBe(base);
    expect(computeRentalHoldRequestFingerprint({ offeringId: "o1", dateKeys: ["2030-07-11"], passengerCount: 2 })).not.toBe(base);
    expect(computeRentalHoldRequestFingerprint({ offeringId: "o1", dateKeys: ["2030-07-10"], passengerCount: 3 })).not.toBe(base);
  });
  it("quote fingerprint changes when a resolved amount or price source changes", () => {
    const base = computeRentalHoldQuoteFingerprint({ offeringId: "o1", currency: "OMR", total: "40.00", days: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", priceSource: "BASE" }] });
    expect(computeRentalHoldQuoteFingerprint({ offeringId: "o1", currency: "OMR", total: "50.00", days: [{ dateKey: "2030-07-10", amount: "50.00", currency: "OMR", priceSource: "BASE" }] })).not.toBe(base);
    expect(computeRentalHoldQuoteFingerprint({ offeringId: "o1", currency: "OMR", total: "40.00", days: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", priceSource: "OVERRIDE" }] })).not.toBe(base);
  });
  it("exposes a positive TTL and a sane maximum selection bound", () => {
    expect(RENTAL_HOLD_TTL_MINUTES).toBeGreaterThan(0);
    expect(MAX_RENTAL_HOLD_DATES).toBe(62);
  });
});
