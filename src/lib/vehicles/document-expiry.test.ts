import { describe, it, expect } from "vitest";
import { isDocumentExpired } from "./document-expiry";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("isDocumentExpired — the one authoritative comparison", () => {
  it("PIN 16 — null expiresAt is never expired (valid)", () => {
    expect(isDocumentExpired(null, NOW)).toBe(false);
  });

  it("PIN 17 — a future expiresAt is valid", () => {
    expect(isDocumentExpired(new Date("2027-01-01T00:00:00.000Z"), NOW)).toBe(false);
    expect(isDocumentExpired(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });

  it("PIN 18 — expiresAt == now is EXPIRED (inclusive boundary)", () => {
    expect(isDocumentExpired(new Date(NOW.getTime()), NOW)).toBe(true);
  });

  it("PIN 19 — a past expiresAt is expired", () => {
    expect(isDocumentExpired(new Date("2000-01-01T00:00:00.000Z"), NOW)).toBe(true);
    expect(isDocumentExpired(new Date(NOW.getTime() - 1), NOW)).toBe(true);
  });
});
