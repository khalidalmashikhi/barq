import { describe, it, expect } from "vitest";
import { uuidv7 } from "./uuid-v7";

describe("uuidv7", () => {
  it("is a well-formed RFC 9562 version-7 UUID (version nibble 7, variant 10)", () => {
    for (let i = 0; i < 200; i++) expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("encodes the millisecond timestamp in the first 48 bits", () => {
    const now = 1_790_000_000_123;
    const id = uuidv7(now);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(now);
  });

  it("sorts by creation time and does not collide", () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7(1_790_000_000_000)));
    expect(ids.size).toBe(5000); // 74 random bits even within one millisecond
  });
});
