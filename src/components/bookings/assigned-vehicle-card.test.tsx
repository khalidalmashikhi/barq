import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { AssignedVehicleCard } = await import("./assigned-vehicle-card");

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
  walk(tree, (e) => {
    if (typeof e.props?.children === "string") out.push(e.props.children as string);
  });
  return out;
}
function inputs(tree: unknown): AnyEl[] {
  const out: AnyEl[] = [];
  walk(tree, (e) => {
    if (e.type === "input" || e.type === "select" || e.type === "button" || e.type === "form") out.push(e);
  });
  return out;
}

const V = {
  make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
  passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false,
};
const customerLabels = { title: "Assigned vehicle", untitled: "Vehicle", guestsSuffix: "guests", fourByFour: "4x4" };
const providerLabels = { ...customerLabels, plate: "Plate" };

describe("AssignedVehicleCard", () => {
  it("customer variant: shows title, vehicle name, facts, no plate, no interactive controls", async () => {
    const tree = await AssignedVehicleCard({ vehicle: V, labels: customerLabels });
    const t = texts(tree);
    expect(t).toContain("Assigned vehicle");
    expect(t).toContain("Toyota Prado");
    // facts line includes year and guests
    expect(t.some((s) => s.includes("2024") && s.includes("6 guests"))).toBe(true);
    // No plate row (no plate label passed) and no plate value.
    expect(t).not.toContain("Plate");
    expect(JSON.stringify(tree)).not.toContain("registrationNumber");
    // Presentation only — no selector/form/button/input.
    expect(inputs(tree)).toHaveLength(0);
  });

  it("4x4 badge shows only when isFourByFour is true", async () => {
    expect(texts(await AssignedVehicleCard({ vehicle: V, labels: customerLabels }))).not.toContain("4x4");
    expect(texts(await AssignedVehicleCard({ vehicle: { ...V, isFourByFour: true }, labels: customerLabels }))).toContain("4x4");
  });

  it("provider variant: shows the plate row when a plate label + registrationNumber are given", async () => {
    const tree = await AssignedVehicleCard({
      vehicle: { ...V, registrationNumber: "QA-TV2-0001" },
      labels: providerLabels,
    });
    const t = texts(tree);
    expect(t).toContain("Plate");
    expect(t).toContain("QA-TV2-0001");
    expect(inputs(tree)).toHaveLength(0); // still no controls
  });

  it("provider variant without a registrationNumber shows no plate row", async () => {
    const t = texts(await AssignedVehicleCard({ vehicle: { ...V, registrationNumber: null }, labels: providerLabels }));
    expect(t).not.toContain("Plate");
  });

  it("falls back to the untitled label when make/model are absent", async () => {
    const t = texts(await AssignedVehicleCard({ vehicle: { ...V, make: null, model: null }, labels: customerLabels }));
    expect(t).toContain("Vehicle");
  });
});
