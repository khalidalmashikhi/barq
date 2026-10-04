import { describe, it, expect, vi, beforeEach } from "vitest";
import { isVehicleSetupIncomplete } from "./vehicle-setup-state";

// The general vehicle-create gate: an APPROVED provider — independent of provider type and of every
// commercial vertical. The rental-workspace predicate must never be consulted.

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
  throw new Error("vehicle-create access must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));

const { resolveVehicleCreateAccess } = await import("./vehicle-create-access");

beforeEach(() => vi.clearAllMocks());

describe("resolveVehicleCreateAccess", () => {
  it.each([
    ["a rental company", { id: "rental-co", status: "APPROVED", providerType: "COMPANY" }],
    ["a tourist guide", { id: "guide", status: "APPROVED", providerType: "INDIVIDUAL" }],
    ["an approved provider with no vertical at all", { id: "plain", status: "APPROVED" }],
  ])("grants %s the SAME access (approved is the only rule)", async (_label, provider) => {
    requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "u" }, provider });
    expect(await resolveVehicleCreateAccess()).toEqual({ ok: true, providerId: provider.id });
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });

  it("a provider that is not approved has no vehicle-create access", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("not approved"));
    expect(await resolveVehicleCreateAccess()).toEqual({ ok: false, reason: "PROVIDER_NOT_APPROVED" });
  });

  it("an unauthenticated caller is reported as such (the page redirects to sign-in)", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError("no session"));
    expect(await resolveVehicleCreateAccess()).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("an unexpected error is not swallowed", async () => {
    requireApprovedProviderMock.mockRejectedValue(new Error("db down"));
    await expect(resolveVehicleCreateAccess()).rejects.toThrow("db down");
  });
});

describe("isVehicleSetupIncomplete", () => {
  it("a vehicle with no confirmed make is an unfinished setup; any confirmed make is finished", () => {
    expect(isVehicleSetupIncomplete({ make: null })).toBe(true);
    expect(isVehicleSetupIncomplete({ make: "Toyota" })).toBe(false);
  });
});
