import { describe, it, expect } from "vitest";
import { isoToFlagEmoji } from "./flag";

describe("isoToFlagEmoji", () => {
  it("maps Oman's ISO to its flag (regional indicators O+M)", () => {
    expect(isoToFlagEmoji("OM")).toBe("\u{1F1F4}\u{1F1F2}"); // 🇴🇲
  });

  it("is case-insensitive and trims", () => {
    expect(isoToFlagEmoji("om")).toBe(isoToFlagEmoji("OM"));
    expect(isoToFlagEmoji("  om  ")).toBe(isoToFlagEmoji("OM"));
  });

  it("maps another ISO correctly (GB)", () => {
    expect(isoToFlagEmoji("GB")).toBe("\u{1F1EC}\u{1F1E7}"); // 🇬🇧
  });

  it("falls back to a neutral white flag for a malformed code (never throws)", () => {
    expect(isoToFlagEmoji("")).toBe("\u{1F3F3}\u{FE0F}");
    expect(isoToFlagEmoji("X")).toBe("\u{1F3F3}\u{FE0F}");
    expect(isoToFlagEmoji("123")).toBe("\u{1F3F3}\u{FE0F}");
  });
});
