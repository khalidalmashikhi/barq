import { describe, it, expect, vi, beforeEach } from "vitest";
import { isVehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";

// Gate 2 — taxonomy is NOT authorization. A vehicle's physical type being a valid member of the
// shared registry must NEVER make it eligible for standalone rental. Rental eligibility is decided
// solely by the provider's RENTAL_COMPANY vertical (canViewRentalWorkspace), which takes a provider
// and consults ONLY status + the vertical authorization — it has no vehicle/type input at all.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: vi.fn(),
  ForbiddenError: class extends Error {},
  UnauthenticatedError: class extends Error {},
}));
const assertRentalDraftAuthorizedMock = vi.fn();
vi.mock("@/lib/offerings/rental/rental-offering-authorization", () => ({
  assertRentalDraftAuthorized: (...a: unknown[]) => assertRentalDraftAuthorizedMock(...a),
}));

const { canViewRentalWorkspace } = await import("@/lib/offerings/rental/provider/rental-workspace-access");

beforeEach(() => vi.clearAllMocks());

describe("taxonomy ≠ rental authorization", () => {
  it("a RENTAL_COMPANY-authorized approved provider CAN view the rental workspace", async () => {
    assertRentalDraftAuthorizedMock.mockResolvedValue(null); // null = authorized
    expect(await canViewRentalWorkspace({ id: "p1", status: "APPROVED" })).toBe(true);
  });

  it("a provider WITHOUT the rental vertical (e.g. a tourist guide) CANNOT — even though SUV/4x4 are valid physical types", async () => {
    // SUV and FOUR_BY_FOUR are perfectly valid taxonomy members…
    expect(isVehicleTypeCode("SUV")).toBe(true);
    expect(isVehicleTypeCode("FOUR_BY_FOUR")).toBe(true);
    // …yet a non-rental-authorized provider is still denied rental workspace access.
    assertRentalDraftAuthorizedMock.mockResolvedValue("NO_RENTAL_VERTICAL");
    expect(await canViewRentalWorkspace({ id: "guide1", status: "APPROVED" })).toBe(false);
  });

  it("a non-APPROVED provider is denied without even consulting the vertical", async () => {
    expect(await canViewRentalWorkspace({ id: "p2", status: "SUSPENDED" as never })).toBe(false);
    expect(assertRentalDraftAuthorizedMock).not.toHaveBeenCalled();
  });

  it("the rental gate takes a provider only — no vehicle-type parameter exists to grant rental", () => {
    // Structural: canViewRentalWorkspace's single argument is the provider; physical type is never
    // an input, so a vehicle can never 'earn' rental eligibility through its body type.
    expect(canViewRentalWorkspace.length).toBe(1);
  });
});
