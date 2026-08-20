import { describe, it, expect } from "vitest";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";

// Editable = the provider may still change documents / submit. ONLY DRAFT and
// CHANGES_REQUESTED. Once SUBMITTED (awaiting admin) or terminal (APPROVED /
// REJECTED), the provider side is locked until admin moves it back.
describe("isAssetVerificationEditable", () => {
  it("DRAFT and CHANGES_REQUESTED are editable", () => {
    expect(isAssetVerificationEditable("DRAFT")).toBe(true);
    expect(isAssetVerificationEditable("CHANGES_REQUESTED")).toBe(true);
  });

  it("SUBMITTED, APPROVED and REJECTED are NOT editable", () => {
    expect(isAssetVerificationEditable("SUBMITTED")).toBe(false);
    expect(isAssetVerificationEditable("APPROVED")).toBe(false);
    expect(isAssetVerificationEditable("REJECTED")).toBe(false);
  });

  it("an unknown value is not editable (fail-closed)", () => {
    expect(isAssetVerificationEditable("WHATEVER")).toBe(false);
  });
});
