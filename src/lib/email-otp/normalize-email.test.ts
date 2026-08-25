import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalize-email";

// AUTH-CUSTOMER-EMAIL-OTP — the single email canonicalization authority. Pure
// (no server-only), so imported directly.

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases the whole address", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toEqual({ ok: true, email: "alice@example.com" });
    expect(normalizeEmail("USER@Sub.Domain.Om")).toEqual({ ok: true, email: "user@sub.domain.om" });
  });

  it("accepts a plus-tagged address without altering the local part beyond lowercasing (no gmail canonicalization)", () => {
    expect(normalizeEmail("Alice.B+tag@Gmail.com")).toEqual({ ok: true, email: "alice.b+tag@gmail.com" });
  });

  it("rejects empty / whitespace-only / non-string", () => {
    expect(normalizeEmail("")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeEmail("   ")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeEmail(undefined)).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeEmail(null)).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeEmail(12345)).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["plainaddress", "a@b", "a@b.", "@example.com", "user@", "user@@example.com", "a b@example.com", "user@exam ple.com", "user@.com"]) {
      expect(normalizeEmail(bad), bad).toEqual({ ok: false, reason: "INVALID_FORMAT" });
    }
  });

  it("rejects an address longer than the practical RFC ceiling", () => {
    const long = "a".repeat(250) + "@example.com";
    expect(normalizeEmail(long)).toEqual({ ok: false, reason: "INVALID_FORMAT" });
  });

  it("accepts a normal multi-label domain", () => {
    expect(normalizeEmail("q@a.co")).toEqual({ ok: true, email: "q@a.co" });
    expect(normalizeEmail("first.last@mail.example.co.uk")).toEqual({ ok: true, email: "first.last@mail.example.co.uk" });
  });
});
