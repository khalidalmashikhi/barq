import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", async () => {
  const errors = await vi.importActual<typeof import("@/lib/auth/errors")>("@/lib/auth/errors");
  return {
    requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
    ForbiddenError: errors.ForbiddenError,
    UnauthenticatedError: errors.UnauthenticatedError,
  };
});

// The established C2b-R vertical draft-authorization gate — mocked here to drive the access matrix
// (its own PENDING/CHANGES/APPROVED vs null/REJECTED/SUSPENDED semantics are covered by the vertical
// suites). canViewRentalWorkspace must consult THIS and nothing category/vehicle-based.
const assertDraftMock = vi.fn();
vi.mock("../rental-offering-authorization", () => ({
  assertRentalDraftAuthorized: (...a: unknown[]) => assertDraftMock(...a),
}));

const { canViewRentalWorkspace, resolveRentalWorkspaceViewAccess } = await import("./rental-workspace-access");

beforeEach(() => {
  requireApprovedProviderMock.mockReset();
  assertDraftMock.mockReset();
});

describe("canViewRentalWorkspace (shared view gate)", () => {
  it("denies a non-APPROVED provider without even consulting the vertical", async () => {
    expect(await canViewRentalWorkspace({ id: "p1", status: "UNDER_REVIEW" })).toBe(false);
    expect(await canViewRentalWorkspace({ id: "p1", status: "SUSPENDED" })).toBe(false);
    expect(assertDraftMock).not.toHaveBeenCalled();
  });

  // The status/access MATRIX (APPROVED provider): the vertical draft-authorization decides view.
  it.each([
    ["rental company, draft-authorized (PENDING/CHANGES/APPROVED, incl. lapsed-compliance APPROVED)", null, true],
    ["tourist-guide-only / unrelated / not-requested / REJECTED / SUSPENDED vertical", "VERTICAL_NOT_AUTHORIZED", false],
  ])("APPROVED provider — %s → view=%s", async (_label, draftResult, expected) => {
    assertDraftMock.mockResolvedValue(draftResult);
    expect(await canViewRentalWorkspace({ id: "p1", status: "APPROVED" })).toBe(expected);
    // Category membership and vehicle ownership are never consulted — only the vertical authority is.
    expect(assertDraftMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRentalWorkspaceViewAccess (page gate)", () => {
  it("maps an unauthenticated caller to UNAUTHENTICATED", async () => {
    requireApprovedProviderMock.mockRejectedValue(new UnauthenticatedError());
    expect(await resolveRentalWorkspaceViewAccess()).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("maps a non-approved provider (ForbiddenError) to NO_RENTAL_ACCESS (non-enumerating)", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no", "PROVIDER_NOT_APPROVED"));
    expect(await resolveRentalWorkspaceViewAccess()).toEqual({ ok: false, reason: "NO_RENTAL_ACCESS" });
    expect(assertDraftMock).not.toHaveBeenCalled();
  });

  it("denies an approved provider whose vertical is not draft-authorized (guide-only/unrelated)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "p1", status: "APPROVED" } });
    assertDraftMock.mockResolvedValue("VERTICAL_NOT_AUTHORIZED");
    expect(await resolveRentalWorkspaceViewAccess()).toEqual({ ok: false, reason: "NO_RENTAL_ACCESS" });
  });

  it("allows an approved rental company and returns the session providerId", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "APPROVED" } });
    assertDraftMock.mockResolvedValue(null);
    expect(await resolveRentalWorkspaceViewAccess()).toEqual({ ok: true, providerId: "prov-1" });
  });
});
