import { describe, it, expect, vi, beforeEach } from "vitest";

// The two Server Actions behind the consent step are thin adapters: the language comes from the
// server, auth errors become coded results, and a decline never carries an attestation.

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "ar" }));
class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({ UnauthenticatedError, ForbiddenError }));
const decide = vi.fn();
vi.mock("@/lib/vehicles/registration-review/decide-ocr-consent", () => ({ decideRegistrationOcrConsent: (...a: unknown[]) => decide(...a) }));

const { grantOcrConsentAction, declineOcrConsentAction } = await import("./consent-actions");

const VEH = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  decide.mockResolvedValue({ ok: true, decision: "GRANTED", analysis: null });
});

describe("consent actions", () => {
  it("grant passes GRANTED, the attestation and the SERVER-side language, and revalidates both review surfaces", async () => {
    expect(await grantOcrConsentAction(VEH, true)).toEqual({ ok: true, decision: "GRANTED", analysis: null });
    expect(decide).toHaveBeenCalledWith(VEH, "GRANTED", { ownerAuthorizationConfirmed: true, locale: "ar" });
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/provider/vehicles/new/[vehicleId]", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/provider/vehicles/[id]", "page");
  });

  it("grant never forwards a truthy non-boolean as an attestation", async () => {
    await grantOcrConsentAction(VEH, "true" as unknown as boolean);
    expect(decide.mock.calls[0]![2]).toMatchObject({ ownerAuthorizationConfirmed: false });
  });

  it("decline passes DECLINED with no attestation", async () => {
    decide.mockResolvedValue({ ok: true, decision: "DECLINED", analysis: null });
    expect(await declineOcrConsentAction(VEH)).toEqual({ ok: true, decision: "DECLINED", analysis: null });
    expect(decide).toHaveBeenCalledWith(VEH, "DECLINED", { ownerAuthorizationConfirmed: false, locale: "ar" });
  });

  it("a failed decision is returned as-is and nothing is revalidated", async () => {
    decide.mockResolvedValue({ ok: false, code: "OWNER_AUTHORIZATION_REQUIRED" });
    expect(await grantOcrConsentAction(VEH, false)).toEqual({ ok: false, code: "OWNER_AUTHORIZATION_REQUIRED" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("auth errors are mapped to coded results, never thrown to the client; unknown errors are generic", async () => {
    decide.mockRejectedValueOnce(new UnauthenticatedError());
    expect(await grantOcrConsentAction(VEH, true)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    decide.mockRejectedValueOnce(new ForbiddenError());
    expect(await declineOcrConsentAction(VEH)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    decide.mockRejectedValueOnce(new Error("boom with details"));
    const res = await grantOcrConsentAction(VEH, true);
    expect(res).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(JSON.stringify(res)).not.toContain("boom");
  });
});
