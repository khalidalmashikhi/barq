import { describe, it, expect } from "vitest";
import { toMeDTO, toBookingSummaryDTO, toBookingDetailDTO, toNotificationDTO } from "./dtos";

describe("toMeDTO", () => {
  it("maps identity + provider state; never leaks internal user fields", () => {
    const dto = toMeDTO(
      { id: "u1", name: "Sara", phoneNumber: "+96890000000", phoneNumberVerified: true },
      { exists: true, status: "APPROVED", type: "COMPANY", workspaceAvailable: true },
      "ar"
    );
    expect(dto).toEqual({
      id: "u1",
      name: "Sara",
      phone: "+96890000000",
      phoneVerified: true,
      locale: "ar",
      provider: { exists: true, status: "APPROVED", type: "COMPANY", workspaceAvailable: true },
    });
  });

  it("represents a customer with no Provider record", () => {
    const dto = toMeDTO(
      { id: "u1", name: null, phoneNumber: null, phoneNumberVerified: false },
      { exists: false, status: null, type: null, workspaceAvailable: false },
      "en"
    );
    expect(dto.provider).toEqual({ exists: false, status: null, type: null, workspaceAvailable: false });
    expect(dto.name).toBeNull();
    expect(dto.phone).toBeNull();
  });

  it("does not copy hostile/internal user fields (authUserId, status)", () => {
    const dto = toMeDTO(
      { id: "u1", name: "x", phoneNumber: "p", phoneNumberVerified: true, authUserId: "au1", status: "ACTIVE" } as never,
      { exists: false, status: null, type: null, workspaceAvailable: false },
      "en"
    );
    const keys = Object.keys(dto);
    expect(keys).not.toContain("authUserId");
    expect(keys).not.toContain("status");
    expect(JSON.stringify(dto)).not.toContain("au1");
  });
});

describe("toBookingSummaryDTO", () => {
  it("maps snapshot price to MoneyDTO string and dates to ISO", () => {
    const dto = toBookingSummaryDTO({
      id: "b1",
      serviceName: "Desert Safari",
      status: "CONFIRMED",
      priceSnapshot: "25 OMR",
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(dto).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceName: "Desert Safari",
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(typeof dto.priceSnapshot!.amount).toBe("string");
  });

  it("maps null price / null slot", () => {
    const dto = toBookingSummaryDTO({
      id: "b1",
      serviceName: "n",
      status: "CREATED",
      priceSnapshot: null,
      slotStartTime: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(dto.priceSnapshot).toBeNull();
    expect(dto.scheduledStartTime).toBeNull();
  });
});

describe("toBookingDetailDTO", () => {
  it("maps detail fields with MoneyDTO string and no internal leakage", () => {
    const dto = toBookingDetailDTO({
      id: "b1",
      serviceId: "s1",
      providerId: "p1",
      serviceName: "Safari",
      providerName: "Desert Co",
      status: "CONFIRMED",
      priceSnapshot: "25 OMR",
      seats: 3,
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      confirmedAt: new Date("2026-05-02T00:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      hasReview: false,
      paymentId: "pay1",
    });
    expect(dto).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceId: "s1",
      serviceName: "Safari",
      providerId: "p1",
      providerName: "Desert Co",
      seats: 3,
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      confirmedAt: "2026-05-02T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      hasReview: false,
      paymentId: "pay1",
    });
  });
});

describe("toNotificationDTO", () => {
  it("maps localized message + read state; kind undefined → null; never the raw payload", () => {
    const dto = toNotificationDTO({
      id: "n1",
      message: "Your booking is confirmed",
      isRead: false,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      causingBookingId: "b1",
      kind: undefined,
    });
    expect(dto).toEqual({
      id: "n1",
      message: "Your booking is confirmed",
      kind: null,
      isRead: false,
      causingBookingId: "b1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("carries a present kind through and preserves read state", () => {
    const dto = toNotificationDTO({
      id: "n2",
      message: "m",
      isRead: true,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      causingBookingId: null,
      kind: "BOOKING_CONFIRMED",
    });
    expect(dto.kind).toBe("BOOKING_CONFIRMED");
    expect(dto.isRead).toBe(true);
    expect(dto.causingBookingId).toBeNull();
  });
});
