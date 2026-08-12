// OTP digit-box input logic — extracted from login-form.tsx as pure, testable
// functions (BUG-1/BUG-2 remediation gate). Mirrors the resend-state.ts pattern:
// the component owns React state/refs/DOM, these helpers own the value logic, so
// typing-order, paste, backspace, and clear behaviour can be unit-tested without a
// DOM harness (this repo has no testing-library/jsdom).
//
// IMPORTANT: this changes NO authentication behaviour. The 6 digit values are
// still joined (in index order) into the exact `code` string passed to
// authClient.phoneNumber.verify — byte-for-byte identical to before. The earlier
// "reversed code" defect was purely a CSS `flex-row-reverse` on the box container
// (fixed in login-form.tsx), never this value logic: digit index 0 is always the
// first digit of the code.

export const OTP_LENGTH = 6;

// A fresh, all-empty OTP value array. Used for the initial state, "change phone
// number", and clearing stale input after a resend.
export function emptyOtp(length: number = OTP_LENGTH): string[] {
  return Array(length).fill("");
}

// Reduce raw input (a keystroke, or a browser auto-fill) to a single digit:
// strip non-digits, keep the LAST one so typing into an already-filled box
// replaces rather than appends.
export function sanitizeOtpDigit(raw: string): string {
  return raw.replace(/\D/g, "").slice(-1);
}

// Immutably set the sanitized digit at `index`, returning a new array (index 0 is
// the first/leftmost digit — the most significant position of the code).
export function setOtpDigit(digits: string[], index: number, raw: string): string[] {
  const next = [...digits];
  next[index] = sanitizeOtpDigit(raw);
  return next;
}

// Which box to focus after entering a digit: the next box to the right, unless we
// just filled the last one (or the entry cleared the box). null = keep focus.
export function nextIndexAfterEntry(index: number, digit: string, length: number = OTP_LENGTH): number | null {
  return digit && index < length - 1 ? index + 1 : null;
}

// Which box to focus on Backspace: the previous box, but only when the current box
// is already empty (so a first backspace clears the current digit, a second moves
// back). null = stay.
export function prevIndexOnBackspace(digits: string[], index: number): number | null {
  return !digits[index] && index > 0 ? index - 1 : null;
}

// Distribute a pasted/typed full code across the boxes: strip non-digits, cap at
// `length`, fill left-to-right (index 0 first). Returns the new digits plus the
// box to focus (the box after the last filled one, capped to the last box), or
// null when the paste contains no digits.
export function parseOtpPaste(
  pasted: string,
  length: number = OTP_LENGTH
): { digits: string[]; focusIndex: number } | null {
  const cleaned = pasted.replace(/\D/g, "").slice(0, length);
  if (!cleaned) return null;
  const digits = emptyOtp(length);
  for (let i = 0; i < cleaned.length; i++) digits[i] = cleaned[i]!;
  return { digits, focusIndex: Math.min(cleaned.length, length - 1) };
}
