import { describe, it, expect } from "vitest";
import {
  OTP_LENGTH,
  emptyOtp,
  sanitizeOtpDigit,
  setOtpDigit,
  nextIndexAfterEntry,
  prevIndexOnBackspace,
  parseOtpPaste,
} from "./otp-input";

// OTP input logic tests (remediation gate). These prove the value logic that
// feeds authClient.phoneNumber.verify is correct — in particular that digits are
// held in reading order (index 0 = first digit), so joining them yields the code
// the user typed, NOT a reversed one. (The reversed-DISPLAY defect was CSS, fixed
// in login-form.tsx; these guard the logic against regressing.)

describe("emptyOtp", () => {
  it("returns an array of empty strings of the OTP length", () => {
    expect(emptyOtp()).toEqual(["", "", "", "", "", ""]);
    expect(emptyOtp()).toHaveLength(OTP_LENGTH);
  });
});

describe("sanitizeOtpDigit", () => {
  it("keeps a single digit", () => {
    expect(sanitizeOtpDigit("7")).toBe("7");
  });
  it("strips non-digits", () => {
    expect(sanitizeOtpDigit("a")).toBe("");
    expect(sanitizeOtpDigit(" 3 ")).toBe("3");
  });
  it("keeps the LAST digit so typing into a filled box replaces it", () => {
    expect(sanitizeOtpDigit("79")).toBe("9");
  });
  it("returns empty for empty input (e.g. a cleared box)", () => {
    expect(sanitizeOtpDigit("")).toBe("");
  });
});

describe("setOtpDigit — typing order", () => {
  it("typing a code one digit at a time yields the digits in reading order", () => {
    // Simulate a user typing "786093" left-to-right, one box at a time.
    let digits = emptyOtp();
    for (const [i, ch] of [..."786093"].entries()) {
      digits = setOtpDigit(digits, i, ch);
    }
    expect(digits).toEqual(["7", "8", "6", "0", "9", "3"]);
    // The value handed to verify() is the reading-order join — NOT reversed.
    expect(digits.join("")).toBe("786093");
  });

  it("is immutable (does not mutate the input array)", () => {
    const before = emptyOtp();
    const after = setOtpDigit(before, 0, "5");
    expect(before).toEqual(["", "", "", "", "", ""]);
    expect(after[0]).toBe("5");
  });

  it("replaces the digit when typing into an already-filled box", () => {
    const digits = setOtpDigit(["1", "", "", "", "", ""], 0, "9");
    expect(digits[0]).toBe("9");
  });
});

describe("nextIndexAfterEntry — focus advance", () => {
  it("advances to the next box after entering a digit", () => {
    expect(nextIndexAfterEntry(0, "7")).toBe(1);
    expect(nextIndexAfterEntry(4, "3")).toBe(5);
  });
  it("does not advance past the last box", () => {
    expect(nextIndexAfterEntry(OTP_LENGTH - 1, "3")).toBeNull();
  });
  it("does not advance when the box was cleared (no digit)", () => {
    expect(nextIndexAfterEntry(2, "")).toBeNull();
  });
});

describe("prevIndexOnBackspace — focus retreat", () => {
  it("moves to the previous box when the current box is already empty", () => {
    expect(prevIndexOnBackspace(["7", "", "", "", "", ""], 1)).toBe(0);
  });
  it("stays put when the current box still has a digit (first backspace clears it)", () => {
    expect(prevIndexOnBackspace(["7", "8", "", "", "", ""], 1)).toBeNull();
  });
  it("stays put at the first box", () => {
    expect(prevIndexOnBackspace(["", "", "", "", "", ""], 0)).toBeNull();
  });
});

describe("parseOtpPaste — full-code paste", () => {
  it("distributes a full pasted code left-to-right and focuses the last box", () => {
    expect(parseOtpPaste("786093")).toEqual({
      digits: ["7", "8", "6", "0", "9", "3"],
      focusIndex: 5,
    });
  });
  it("strips non-digits and spaces from the pasted text", () => {
    expect(parseOtpPaste(" 78-60 93 ")).toEqual({
      digits: ["7", "8", "6", "0", "9", "3"],
      focusIndex: 5,
    });
  });
  it("handles a partial paste, focusing the box after the last filled one", () => {
    expect(parseOtpPaste("786")).toEqual({
      digits: ["7", "8", "6", "", "", ""],
      focusIndex: 3,
    });
  });
  it("caps an over-long paste at the OTP length", () => {
    const result = parseOtpPaste("7860931234");
    expect(result?.digits).toEqual(["7", "8", "6", "0", "9", "3"]);
    expect(result?.focusIndex).toBe(5);
  });
  it("returns null when the paste has no digits", () => {
    expect(parseOtpPaste("abc")).toBeNull();
    expect(parseOtpPaste("")).toBeNull();
  });
});
