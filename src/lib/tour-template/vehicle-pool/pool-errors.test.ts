import { describe, it, expect } from "vitest";
import {
  TOUR_VEHICLE_POOL_ERROR_CODES,
  isTourVehiclePoolErrorCode,
  getTourVehiclePoolErrorTranslationKey,
} from "./pool-errors";

describe("tour vehicle-pool error contract", () => {
  it("every code maps to a distinct, stable translation key", () => {
    const keys = TOUR_VEHICLE_POOL_ERROR_CODES.map(getTourVehiclePoolErrorTranslationKey);
    expect(new Set(keys).size).toBe(TOUR_VEHICLE_POOL_ERROR_CODES.length);
    for (const key of keys) expect(key.startsWith("tourVehiclePoolError")).toBe(true);
  });

  it("isTourVehiclePoolErrorCode never trusts an arbitrary query value", () => {
    expect(isTourVehiclePoolErrorCode("VEHICLE_NOT_ELIGIBLE")).toBe(true);
    expect(isTourVehiclePoolErrorCode("SERVICE_NOT_FOUND")).toBe(true);
    expect(isTourVehiclePoolErrorCode("__proto__")).toBe(false);
    expect(isTourVehiclePoolErrorCode("")).toBe(false);
    expect(isTourVehiclePoolErrorCode(null)).toBe(false);
  });
});
