import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth", () => ({ UnauthenticatedError: class UnauthenticatedError extends Error {}, ForbiddenError: class ForbiddenError extends Error {} }));
const runAnalysis = vi.fn();
vi.mock("@/lib/vehicles/registration-review/run-registration-analysis", () => ({ runRegistrationAnalysis: (...a: unknown[]) => runAnalysis(...a) }));
const writeConf = vi.fn();
vi.mock("@/lib/vehicles/registration-review/write-confirmation", () => ({ writeRegistrationConfirmation: (...a: unknown[]) => writeConf(...a) }));

const { analyzeRegistrationAction, saveRegistrationDraftAction, submitRegistrationConfirmationAction } = await import("./registration-actions");
const { UnauthenticatedError, ForbiddenError } = await import("@/lib/auth");

beforeEach(() => vi.clearAllMocks());

describe("registration-actions", () => {
  it("analyze ok → returns result and revalidates the detail page", async () => {
    runAnalysis.mockResolvedValue({ ok: true, status: "EXTRACTED", failureLabelKey: null });
    const res = await analyzeRegistrationAction("v1");
    expect(res).toMatchObject({ ok: true, status: "EXTRACTED" });
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/provider/vehicles/[id]", "page");
  });

  it("analyze: UnauthenticatedError → UNAUTHENTICATED; ForbiddenError → VEHICLE_NOT_FOUND (non-enumerating)", async () => {
    runAnalysis.mockRejectedValueOnce(new UnauthenticatedError());
    expect(await analyzeRegistrationAction("v1")).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    runAnalysis.mockRejectedValueOnce(new ForbiddenError());
    expect(await analyzeRegistrationAction("v1")).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });

  it("analyze: an unexpected throw → UNKNOWN_ERROR, no revalidate", async () => {
    runAnalysis.mockRejectedValueOnce(new Error("boom"));
    expect(await analyzeRegistrationAction("v1")).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("saveDraft/submit pass through the coded result; revalidate only on ok", async () => {
    writeConf.mockResolvedValueOnce({ ok: true });
    expect(await saveRegistrationDraftAction("v1", { make: "Toyota" })).toEqual({ ok: true });
    expect(writeConf).toHaveBeenCalledWith("DRAFT", "v1", { make: "Toyota" });

    writeConf.mockResolvedValueOnce({ ok: false, code: "INVALID_INPUT", fieldErrors: [{ field: "vin", code: "REQUIRED" }] });
    const res = await submitRegistrationConfirmationAction("v1", {});
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(writeConf).toHaveBeenLastCalledWith("SUBMIT", "v1", {});
    expect(revalidatePath).toHaveBeenCalledTimes(1); // only the ok saveDraft above
  });
});
