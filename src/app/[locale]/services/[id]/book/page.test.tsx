import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// BOOKING-SLOT-AUTHORITY — the booking form's three slot states.
//
// The behaviour under test is customer-visible, so these assert what the page RENDERS
// rather than which helper it happened to call: is there a slot selector, is there a
// submittable form, is the honest empty state shown.
//
// The state that matters most is the third. Before this gate the page decided "does
// this need a slot?" from `slots.length > 0`, so a slot-based service whose slots were
// all full or past rendered a form with NO slot selector — one that could submit
// without an availabilityId and skip the atomic capacity guard entirely. That form
// must no longer exist.

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const isActiveAdminSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: (...a: unknown[]) => getSessionMock(...a),
  isActiveAdminSession: (...a: unknown[]) => isActiveAdminSessionMock(...a),
}));

vi.mock("@/lib/auth/barq-user", () => ({
  resolveBarqUser: vi.fn().mockResolvedValue({ id: "u1" }),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  Link: ({ children }: { children?: unknown }) => children,
}));

const getServiceByIdMock = vi.fn();
const getActivePricesMock = vi.fn();
vi.mock("@/lib/services/get-service-detail", () => ({
  getServiceById: (...a: unknown[]) => getServiceByIdMock(...a),
  getActivePricesForService: (...a: unknown[]) => getActivePricesMock(...a),
}));

const getAvailableSlotsMock = vi.fn();
vi.mock("@/lib/booking/get-available-slots", () => ({
  getAvailableSlots: (...a: unknown[]) => getAvailableSlotsMock(...a),
}));

const serviceRequiresSlotMock = vi.fn();
vi.mock("@/lib/booking/service-requires-slot", () => ({
  serviceRequiresSlot: (...a: unknown[]) => serviceRequiresSlotMock(...a),
}));

vi.mock("@/lib/db", () => ({
  prisma: { customer: { findUnique: vi.fn().mockResolvedValue({ id: "c1" }) } },
}));

vi.mock("@/lib/booking/create-booking", () => ({ createBooking: vi.fn() }));

// Translator returns the KEY, so an assertion on "noSlotsAvailableLabel" proves the
// committed key is used rather than matching prose that could drift.
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/format-date", () => ({ formatDate: () => "1 September 2026, 10:00" }));

vi.mock("@/components/layout/navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/components/bookings/booking-steps-indicator", () => ({ BookingStepsIndicator: () => null }));

const { default: BookServicePage } = await import("./page");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PRICE_ID = "019f4e4e-80b8-7cf2-b043-916c71648fcb";
const SLOT_ID = "019f4e4e-8300-7b22-8d4f-2b3c4d5e6f70";

/** Render to a plain tree and flatten it, so assertions read the customer's view. */
async function render(): Promise<string> {
  const element = (await BookServicePage({
    params: Promise.resolve({ id: SERVICE_ID }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;

  return JSON.stringify(element);
}

function slot() {
  return {
    id: SLOT_ID,
    startTime: new Date("2026-09-01T10:00:00.000Z"),
    endTime: new Date("2026-09-01T13:00:00.000Z"),
    remainingSeats: 3,
  };
}

function setUp({ requiresSlot, slots }: { requiresSlot: boolean; slots: ReturnType<typeof slot>[] }) {
  getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  isActiveAdminSessionMock.mockResolvedValue(false);
  getServiceByIdMock.mockResolvedValue({
    id: SERVICE_ID,
    name: "Wadi Shab hike",
    providerName: "Muscat Trails",
  });
  getActivePricesMock.mockResolvedValue([{ id: PRICE_ID, amount: "25.00", currency: "OMR" }]);
  getAvailableSlotsMock.mockResolvedValue(slots);
  serviceRequiresSlotMock.mockResolvedValue(requiresSlot);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BookServicePage — slot requirement", () => {
  // --- state 1: genuinely slotless ------------------------------------------

  it("renders a submittable form with no slot selector for a slotless service", async () => {
    setUp({ requiresSlot: false, slots: [] });

    const tree = await render();

    expect(tree).toContain("confirmBookingButton");
    expect(tree).toContain("selectPriceLabel");
    // No slot selector, and no seats field — seats has no capacity meaning without a slot.
    expect(tree).not.toContain("selectSlotLabel");
    expect(tree).not.toContain("seatsLabel");
    expect(tree).not.toContain("noSlotsAvailableLabel");
  });

  // --- state 2: slot-based with slots ---------------------------------------

  it("requires slot selection when the service is slot-based and slots exist", async () => {
    setUp({ requiresSlot: true, slots: [slot()] });

    const tree = await render();

    expect(tree).toContain("selectSlotLabel");
    expect(tree).toContain("seatsLabel");
    expect(tree).toContain("confirmBookingButton");
    expect(tree).toContain(SLOT_ID);
    expect(tree).not.toContain("noSlotsAvailableLabel");
  });

  // --- state 3: slot-based, nothing bookable --------------------------------

  /**
   * THE STATE THAT COULD NOT PREVIOUSLY BE EXPRESSED. Identical `slots` to state 1,
   * opposite meaning — and the old `slots.length > 0` rule rendered a slot-less
   * SUBMITTABLE form here, which is exactly the capacity bypass.
   */
  it("renders NO submittable form when the service is slot-based but nothing is bookable", async () => {
    setUp({ requiresSlot: true, slots: [] });

    const tree = await render();

    // The honest empty state, using the committed key.
    expect(tree).toContain("noSlotsAvailableLabel");
    // And crucially: no confirm action at all, so nothing can be submitted slotlessly.
    expect(tree).not.toContain("confirmBookingButton");
    expect(tree).not.toContain("selectPriceLabel");
    expect(tree).not.toContain("selectSlotLabel");
  });

  it("distinguishes an empty slot list by the authority, not by the list", async () => {
    setUp({ requiresSlot: false, slots: [] });
    const slotless = await render();

    vi.clearAllMocks();
    setUp({ requiresSlot: true, slots: [] });
    const declared = await render();

    // Same `slots` ([]), opposite rendering — which is the whole point of the field.
    expect(slotless).toContain("confirmBookingButton");
    expect(declared).not.toContain("confirmBookingButton");
  });

  // --- the authority is consulted, and only for the resolved service --------

  it("asks the shared authority rather than re-deriving the rule", async () => {
    setUp({ requiresSlot: true, slots: [slot()] });

    await render();

    expect(serviceRequiresSlotMock).toHaveBeenCalledWith(SERVICE_ID);
  });

  // --- unrelated existing behaviour stays put -------------------------------

  it("still shows the no-prices state ahead of any slot consideration", async () => {
    setUp({ requiresSlot: true, slots: [] });
    getActivePricesMock.mockResolvedValue([]);

    const tree = await render();

    expect(tree).toContain("noPricesAvailableLabel");
    expect(tree).not.toContain("noSlotsAvailableLabel");
    expect(tree).not.toContain("confirmBookingButton");
  });
});
