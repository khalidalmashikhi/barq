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

// AUTH-DUAL-VERIFICATION-1 — the book page enforces the dual-verified customer gate;
// mocked to a no-op so these tests exercise the booking page's own behavior.
const requireCompleteCustomerMock = vi.fn();
vi.mock("@/lib/auth/require-complete-customer", () => ({
  requireCompleteCustomer: (...a: unknown[]) => requireCompleteCustomerMock(...a),
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
// committed key is used rather than matching prose that could drift. Interpolated values
// are appended rather than substituted: BOOKING-PRICE-SEMANTICS renders a priced option
// through common.priceWithUnit, and a mock that returned the bare key would hide both the
// amount and the unit, letting a wrong or missing unit pass unnoticed.
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string, values?: Record<string, unknown>) =>
    values
      ? `${k}(${Object.entries(values)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(",")})`
      : k
  ),
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
  getActivePricesMock.mockResolvedValue([
    {
      id: PRICE_ID,
      amount: "25.00",
      currency: "OMR",
      pricingUnit: "PER_PERSON",
      pricingUnitLabel: "per person",
    },
  ]);
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

// BOOKING-PRICE-SEMANTICS — this page is where the customer actually CHOOSES a price, so
// it is the surface where an unstated pricing basis does real damage: two bare amounts are
// not a choice anyone can reason about. The unit is resolved by the Platform and rendered
// through the committed common.priceWithUnit key.
describe("BookServicePage — pricing unit on each option", () => {
  const SECOND_PRICE_ID = "019f4e4e-80b8-7cf2-b043-916c71648fcc";

  function withPrices(prices: Record<string, unknown>[]) {
    setUp({ requiresSlot: false, slots: [] });
    getActivePricesMock.mockResolvedValue(prices);
  }

  function price(over: Record<string, unknown> = {}) {
    return {
      id: PRICE_ID,
      amount: "25.00",
      currency: "OMR",
      pricingUnit: "PER_PERSON",
      pricingUnitLabel: "per person",
      ...over,
    };
  }

  it("renders the amount with its unit label through the committed key", async () => {
    withPrices([price()]);

    const tree = await render();

    expect(tree).toContain("priceWithUnit(price=25.00 OMR,unit=per person)");
  });

  /** THE CASE THE WHOLE GATE EXISTS FOR — each option states its own basis. */
  it("labels two options with their own distinct units", async () => {
    withPrices([
      price({ id: PRICE_ID, amount: "25.00", pricingUnitLabel: "per person" }),
      price({ id: SECOND_PRICE_ID, amount: "40.50", pricingUnit: "PER_DAY", pricingUnitLabel: "per day" }),
    ]);

    const tree = await render();

    expect(tree).toContain("priceWithUnit(price=25.00 OMR,unit=per person)");
    expect(tree).toContain("priceWithUnit(price=40.50 OMR,unit=per day)");
  });

  it("still offers exactly one selectable radio per price, keyed by the exact price id", async () => {
    withPrices([price(), price({ id: SECOND_PRICE_ID })]);

    const tree = await render();

    expect(tree).toContain(PRICE_ID);
    expect(tree).toContain(SECOND_PRICE_ID);
    // The submitted value is the price ID, never the amount or the unit.
    expect(tree).toContain(`"name":"priceId","value":"${PRICE_ID}"`);
    expect(tree).toContain(`"name":"priceId","value":"${SECOND_PRICE_ID}"`);
  });

  // --- a missing label must degrade to the amount, never to a code ----------

  /**
   * A legacy flat price, and a code this build does not govern yet, both arrive with a
   * null label. Either must render as the amount alone: a raw SCREAMING_CASE code shown
   * to a customer is worse than saying nothing about the basis.
   */
  it("shows the bare amount for a legacy price with no unit", async () => {
    withPrices([price({ pricingUnit: null, pricingUnitLabel: null })]);

    const tree = await render();

    expect(tree).toContain("25.00 OMR");
    expect(tree).not.toContain("priceWithUnit");
  });

  it("never renders the raw code when the unit is not yet governed", async () => {
    withPrices([price({ pricingUnit: "PER_NIGHT", pricingUnitLabel: null })]);

    const tree = await render();

    expect(tree).toContain("25.00 OMR");
    expect(tree).not.toContain("PER_NIGHT");
    expect(tree).not.toContain("priceWithUnit");
  });

  it("keeps the form submittable when a label is missing", async () => {
    withPrices([price({ pricingUnit: null, pricingUnitLabel: null })]);

    const tree = await render();

    // An unlabelled price is still a bookable price.
    expect(tree).toContain("confirmBookingButton");
    expect(tree).toContain("selectPriceLabel");
    expect(tree).toContain(PRICE_ID);
  });

  /**
   * The SERVICE-level pricingUnit comes from the first active price only, so using it to
   * label the list would label one option right and mislabel every other one.
   */
  it("does not fall back to the service-level unit for an unlabelled option", async () => {
    setUp({ requiresSlot: false, slots: [] });
    getServiceByIdMock.mockResolvedValue({
      id: SERVICE_ID,
      name: "Wadi Shab hike",
      providerName: "Muscat Trails",
      pricingUnit: "PER_PERSON",
      pricingUnitLabel: "per person",
    });
    getActivePricesMock.mockResolvedValue([price({ pricingUnit: null, pricingUnitLabel: null })]);

    const tree = await render();

    expect(tree).not.toContain("per person");
    expect(tree).toContain("25.00 OMR");
  });
});

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — the expected-total island is wired into the form, and the
// submission carries ONLY selectors (never an authoritative client total). The idempotency key is
// server-rendered once per page render and the client island does not touch it.
describe("BookServicePage — pre-submit estimate + submission integrity", () => {
  function setUpBookable() {
    setUp({ requiresSlot: true, slots: [slot()] });
  }

  it("renders the expected-total estimate island with the server-provided price facts", async () => {
    setUpBookable();
    const tree = await render();
    // The island receives the estimate labels (translator returns the key) and the price facts.
    expect(tree).toContain("estimatedTotalLabel");
    expect(tree).toContain("estimatedTotalSelectPriceLabel");
    // It is fed the price id + the SERVER-classified billability token (never the raw unit code).
    expect(tree).toContain(PRICE_ID);
    expect(tree).toContain("QUANTITY_BASED");
    expect(tree).not.toContain("PER_PERSON"); // the raw code never crosses to the client island
  });

  it("keeps the per-render idempotency key server-rendered as a hidden input (island never owns it)", async () => {
    setUpBookable();
    const tree = await render();
    expect(tree).toContain('"name":"idempotencyKey"');
  });

  it("submits ONLY selectors — the form has no authoritative total/amount/currency input", async () => {
    setUpBookable();
    const tree = await render();
    // The estimate is display-only; it must never become a submitted authoritative money field.
    expect(tree).not.toContain('"name":"total"');
    expect(tree).not.toContain('"name":"amount"');
    expect(tree).not.toContain('"name":"currency"');
    expect(tree).not.toContain('"name":"bookingTotal"');
  });

  it("shows a pending-submit label on the confirm button (UX only)", async () => {
    setUpBookable();
    const tree = await render();
    expect(tree).toContain("bookingInProgressLabel");
  });
});
