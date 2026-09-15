import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { toRentalOfferingDTO, type RentalOfferingDtoRow } from "./rental-offering-dto";

// Phase 3C Slice C2b-R — the allowlisted provider DTO. Money is a 2dp string; effective capacity is
// override ?? verified; no private/internal field can leak (the mapper is field-by-field).

const baseRow = (over: Partial<RentalOfferingDtoRow> = {}): RentalOfferingDtoRow => ({
  id: "01a0-off",
  serviceId: "01a0-svc",
  vehicleId: "01a0-veh",
  status: "DRAFT",
  baseDailyAmount: new Prisma.Decimal("40"),
  currency: "OMR",
  offeringCapacityOverride: null,
  createdAt: new Date("2026-09-01T08:00:00.000Z"),
  updatedAt: new Date("2026-09-02T09:30:00.000Z"),
  ...over,
});

describe("toRentalOfferingDTO", () => {
  it("emits exactly the allowlisted keys (no extra fields leak)", () => {
    const dto = toRentalOfferingDTO(baseRow(), 7);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "baseDailyAmount",
        "createdAt",
        "currency",
        "effectiveCapacity",
        "id",
        "offeringCapacityOverride",
        "serviceId",
        "status",
        "updatedAt",
        "vehicleId",
        "verifiedVehicleCapacity",
      ].sort(),
    );
  });
  it("formats money to a 2dp string and timestamps to ISO", () => {
    const dto = toRentalOfferingDTO(baseRow({ baseDailyAmount: new Prisma.Decimal("40.5") }), 7);
    expect(dto.baseDailyAmount).toBe("40.50");
    expect(dto.createdAt).toBe("2026-09-01T08:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-09-02T09:30:00.000Z");
  });
  it("effective capacity = override when set, else verified", () => {
    expect(toRentalOfferingDTO(baseRow({ offeringCapacityOverride: 4 }), 7)).toMatchObject({
      verifiedVehicleCapacity: 7,
      offeringCapacityOverride: 4,
      effectiveCapacity: 4,
    });
    expect(toRentalOfferingDTO(baseRow({ offeringCapacityOverride: null }), 7)).toMatchObject({
      offeringCapacityOverride: null,
      effectiveCapacity: 7,
    });
  });
  it("null verified capacity with no override → effective null (nothing invented)", () => {
    expect(toRentalOfferingDTO(baseRow(), null)).toMatchObject({
      verifiedVehicleCapacity: null,
      effectiveCapacity: null,
    });
  });
});
