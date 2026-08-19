import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));
const getProviderVehiclesMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicles", () => ({ getProviderVehicles: (...a: unknown[]) => getProviderVehiclesMock(...a) }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props, redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

const { default: ProviderVehiclesPage } = await import("./page");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function collectHrefs(el: unknown, acc: string[] = []): string[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => collectHrefs(c, acc)), acc;
  const e = el as AnyEl;
  if (typeof e.props?.href === "string") acc.push(e.props.href as string);
  collectHrefs(e.props?.children, acc);
  return acc;
}
function collectStrings(el: unknown, acc: string[] = []): string[] {
  if (typeof el === "string") return acc.push(el), acc;
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => collectStrings(c, acc)), acc;
  const e = el as AnyEl;
  for (const v of Object.values(e.props ?? {})) collectStrings(v, acc);
  return acc;
}
function findProp(el: unknown, key: string, acc: unknown[] = []): unknown[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => findProp(c, key, acc)), acc;
  const e = el as AnyEl;
  if (e.props && key in e.props) acc.push(e.props[key]);
  findProp(e.props?.children, key, acc);
  return acc;
}

const vehicle = (over: Record<string, unknown> = {}) => ({
  id: "veh-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: null,
  registrationNumber: "OM 12345",
  status: "REGISTERED",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

afterEach(() => getProviderVehiclesMock.mockReset());

describe("ProviderVehiclesPage", () => {
  it("renders a card per vehicle, each linking to its detail (multi-vehicle)", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({ id: "veh-1" }), vehicle({ id: "veh-2", make: "Nissan", model: "Patrol" })]);
    const hrefs = collectHrefs(await ProviderVehiclesPage());
    expect(hrefs).toContain("/provider/vehicles/veh-1");
    expect(hrefs).toContain("/provider/vehicles/veh-2");
    expect(hrefs).toContain("/provider/vehicles/new"); // Add CTA
  });

  it("uses make + model as the card title and shows the private registration number", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({})]);
    const strings = collectStrings(await ProviderVehiclesPage());
    expect(strings).toContain("Toyota Land Cruiser");
    expect(strings).toContain("OM 12345"); // private reg visible to owner
  });

  it("renders safely when legacy make/model are null (deterministic fallback title)", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({ make: null, model: null, registrationNumber: null })]);
    const strings = collectStrings(await ProviderVehiclesPage());
    expect(strings).toContain("vehicleUntitled"); // fallback key, no crash
  });

  it("shows a polished empty state with an Add CTA when there are no vehicles", async () => {
    getProviderVehiclesMock.mockResolvedValue([]);
    const el = await ProviderVehiclesPage();
    const messages = findProp(el, "message");
    expect(messages).toContain("noVehiclesLabel");
    expect(collectHrefs(el)).toContain("/provider/vehicles/new");
  });
});
