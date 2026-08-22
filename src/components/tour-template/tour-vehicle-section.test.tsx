import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { TourVehicleSection } = await import("./tour-vehicle-section");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function walk(el: unknown, visit: (e: AnyEl) => void): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return el.forEach((c) => walk(c, visit));
  const e = el as AnyEl;
  visit(e);
  walk(e.props?.children, visit);
}
function texts(tree: unknown): string[] {
  const out: string[] = [];
  walk(tree, (e) => { if (typeof e.props?.children === "string") out.push(e.props.children as string); });
  return out;
}
function countCards(tree: unknown): number {
  let n = 0;
  walk(tree, (e) => { if (e.type === "li") n++; });
  return n;
}

const V = { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false };

describe("TourVehicleSection (customer)", () => {
  it("transport tour with an eligible vehicle: shows transport-included + vehicle card + representative note; no private data", async () => {
    const summary = { transportIncluded: true, requiresFourByFour: false, vehicles: [V] };
    const tree = await TourVehicleSection({ summary: summary as never });
    const t = texts(tree);
    expect(t).toContain("tourTransportIncluded");
    expect(t).toContain("tourVehiclesHeading");
    expect(t).toContain("Toyota Prado"); // make + model title
    expect(t).toContain("tourVehiclesRepresentativeNote"); // honest "examples, not assigned" note
    expect(countCards(tree)).toBe(1);
    // Privacy — the slim summary carries nothing private; the tree contains no plate/registration.
    const json = JSON.stringify(tree);
    expect(json).not.toContain("registrationNumber");
    expect(json).not.toContain("OM ");
  });

  it("GUIDE_WITH_4X4: shows the verified-4x4 badge and a 4x4 chip on a trusted-4x4 vehicle", async () => {
    const summary = { transportIncluded: true, requiresFourByFour: true, vehicles: [{ ...V, isFourByFour: true }] };
    const t = texts(await TourVehicleSection({ summary: summary as never }));
    expect(t).toContain("tourVerified4x4");
    expect(t).toContain("tourVehicle4x4Badge");
  });

  it("degraded transport tour (no eligible vehicle): shows transport-included + unavailable note, no vehicle cards", async () => {
    const summary = { transportIncluded: true, requiresFourByFour: false, vehicles: [] };
    const tree = await TourVehicleSection({ summary: summary as never });
    const t = texts(tree);
    expect(t).toContain("tourTransportIncluded");
    expect(t).toContain("tourVehicleUnavailable");
    expect(t).not.toContain("tourVehiclesHeading");
    expect(countCards(tree)).toBe(0);
  });

  it("multiple eligible vehicles => multiple cards", async () => {
    const summary = { transportIncluded: true, requiresFourByFour: false, vehicles: [V, { ...V, model: "Patrol" }, { ...V, model: "Land Cruiser" }] };
    expect(countCards(await TourVehicleSection({ summary: summary as never }))).toBe(3);
  });
});
