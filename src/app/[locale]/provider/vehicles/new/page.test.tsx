import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The new-vehicle route is DOCUMENT-FIRST for every provider who may register a vehicle. It renders
// only the registration-upload step — never the legacy direct-entry form — and is selected by the
// general vehicle authority, never by the rental workspace predicate.

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
const rentalPredicateMock = vi.fn(() => {
  throw new Error("the new-vehicle page must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "ar" }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props, redirect: (...a: unknown[]) => redirectMock(...a) }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("./_components/registration-upload-form", () => ({ RegistrationUploadForm: function RegistrationUploadForm() { return null; } }));

const { default: NewVehiclePage } = await import("./page");
const { RegistrationUploadForm } = await import("./_components/registration-upload-form");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function findAll(el: unknown, pred: (e: AnyEl) => boolean, acc: AnyEl[] = []): AnyEl[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => findAll(c, pred, acc)), acc;
  const e = el as AnyEl;
  if (e.props && pred(e)) acc.push(e);
  findAll(e.props?.children, pred, acc);
  return acc;
}
function strings(el: unknown, acc: string[] = []): string[] {
  if (typeof el === "string") return acc.push(el), acc;
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => strings(c, acc)), acc;
  for (const v of Object.values((el as AnyEl).props ?? {})) strings(v, acc);
  return acc;
}
const props = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });
const LEGACY_FIELD_NAMES = ["make", "model", "modelYear", "color", "vehicleType", "registeredSeats", "passengerCapacity", "registrationNumber", "publicDescription", "claimedFourByFour"];

beforeEach(() => vi.clearAllMocks());

describe("NewVehiclePage — document-first for every eligible provider", () => {
  it.each([
    ["a rental company", { id: "rental-co", status: "APPROVED" }],
    ["a tourist guide (no rental vertical)", { id: "guide", status: "APPROVED" }],
  ])("%s sees the SAME registration-upload step, selected without the rental predicate", async (_label, provider) => {
    requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u" }, provider });
    const el = await NewVehiclePage(props());

    const upload = findAll(el, (e) => e.type === RegistrationUploadForm);
    expect(upload).toHaveLength(1);
    expect(upload[0]!.props).toMatchObject({ action: "/api/provider/vehicles/onboarding/upload", locale: "ar", cancelHref: "/provider/vehicles" });
    expect(rentalPredicateMock).not.toHaveBeenCalled();

    // Title + document-first explanation; vertical-neutral (no rental wording keys).
    const text = strings(el);
    expect(text).toContain("addVehicleButton");
    expect(text).toContain("vehicleOnboardUploadSubtitle");
  });

  it("never renders the legacy direct-entry form or any vehicle detail field before a document is uploaded", async () => {
    requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u" }, provider: { id: "p", status: "APPROVED" } });
    const el = await NewVehiclePage(props());
    const legacyInputs = findAll(el, (e) => typeof e.props.name === "string" && LEGACY_FIELD_NAMES.includes(e.props.name as string));
    expect(legacyInputs).toHaveLength(0);
    // No inline server action (function-valued form action) exists on this page at all.
    expect(findAll(el, (e) => e.type === "form" && typeof e.props.action === "function")).toHaveLength(0);
  });

  it("a provider without vehicle-create authority (not approved) gets notFound — no creation surface", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("not approved"));
    await expect(NewVehiclePage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an unauthenticated visitor is redirected to sign-in", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError("no session"));
    const el = await NewVehiclePage(props());
    expect(el).toBeNull();
    expect(redirectMock).toHaveBeenCalledWith(expect.objectContaining({ href: "/login" }));
  });

  it("shows a localized upload error (known document code) or a generic one (unknown code)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u" }, provider: { id: "p", status: "APPROVED" } });
    expect(strings(await NewVehiclePage(props({ uploadError: "TOO_LARGE" })))).toContain("vehicleDocErrorTooLarge");
    const unknown = strings(await NewVehiclePage(props({ uploadError: "<script>" })));
    expect(unknown).toContain("vehicleOnboardUploadFailed");
    expect(unknown).not.toContain("<script>"); // a raw query value is never echoed
  });

  it("the page source has no direct-create dependency (createVehicle / legacy form / rental predicate / server action)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/[locale]/provider/vehicles/new/page.tsx"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/create-vehicle|createVehicle|vehicle-form-fields|VehicleFormFields|formDataToVehicleInput/);
    expect(code).not.toMatch(/rental-workspace-access|canViewRentalWorkspace|resolveRentalWorkspaceViewAccess/);
    expect(code).not.toMatch(/["']use server["']/);
  });
});
