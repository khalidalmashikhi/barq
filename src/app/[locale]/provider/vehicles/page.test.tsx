import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));
const getProviderVehiclesMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicles", () => ({ getProviderVehicles: (...a: unknown[]) => getProviderVehiclesMock(...a) }));
// The vehicle list must not depend on the rental workspace predicate at all: any use throws.
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  resolveRentalWorkspaceViewAccess: () => {
    throw new Error("the vehicle list must never consult the rental workspace predicate");
  },
}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props, redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
// The "Add vehicle" entry point is a client link that starts a NEW onboarding attempt (it drops the
// tab's previous request key). Stubbed so the tree can be inspected without a DOM.
vi.mock("./_components/add-vehicle-link", () => ({ AddVehicleLink: function AddVehicleLink() { return null; } }));

const { default: ProviderVehiclesPage } = await import("./page");
const { AddVehicleLink } = await import("./_components/add-vehicle-link");
function countAddLinks(el: unknown): number {
  if (!el || typeof el !== "object") return 0;
  if (Array.isArray(el)) return el.reduce((sum: number, c) => sum + countAddLinks(c), 0);
  const e = el as { type: unknown; props?: Record<string, unknown> };
  return (e.type === AddVehicleLink ? 1 : 0) + Object.values(e.props ?? {}).reduce((sum: number, v) => sum + countAddLinks(v), 0);
}

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
    const el = await ProviderVehiclesPage();
    const hrefs = collectHrefs(el);
    expect(hrefs).toContain("/provider/vehicles/veh-1");
    expect(hrefs).toContain("/provider/vehicles/veh-2");
    expect(countAddLinks(el)).toBe(1); // Add CTA — the explicit "new vehicle" entry point
    expect(hrefs).not.toContain("/provider/vehicles/new"); // never a plain link that would silently reuse an old request key
  });

  it("uses make + model as the card title and shows the private registration number", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({})]);
    const strings = collectStrings(await ProviderVehiclesPage());
    expect(strings).toContain("Toyota Land Cruiser");
    expect(strings).toContain("OM 12345"); // private reg visible to owner
  });

  it("an unfinished setup is labeled 'setup incomplete' and links back to the review step for ANY provider (no rental predicate)", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({ id: "shell-1", make: null, model: null, registrationNumber: null })]);
    const el = await ProviderVehiclesPage();
    const strings = collectStrings(el);
    expect(strings).toContain("vehicleSetupIncomplete"); // the badge — never presented as a normal completed vehicle
    expect(strings).not.toContain("vehicleStatusRegistered"); // the operational status badge is replaced
    const hrefs = collectHrefs(el);
    expect(hrefs).toContain("/provider/vehicles/new/shell-1"); // resume the document-first review
    expect(hrefs).not.toContain("/provider/vehicles/shell-1"); // never the direct detail/edit surface
  });

  it("a COMPLETE vehicle is never mislabeled as incomplete and links to its detail", async () => {
    getProviderVehiclesMock.mockResolvedValue([vehicle({ id: "veh-9" })]);
    const el = await ProviderVehiclesPage();
    expect(collectHrefs(el)).toContain("/provider/vehicles/veh-9");
    expect(collectStrings(el)).not.toContain("vehicleSetupIncomplete");
  });

  it("shows a polished empty state with an Add CTA when there are no vehicles", async () => {
    getProviderVehiclesMock.mockResolvedValue([]);
    const el = await ProviderVehiclesPage();
    const messages = findProp(el, "message");
    expect(messages).toContain("noVehiclesLabel");
    expect(countAddLinks(el)).toBe(2); // header CTA + empty-state CTA, both the explicit entry point
    expect(collectHrefs(el)).not.toContain("/provider/vehicles/new");
  });
});
