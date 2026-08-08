import { describe, it, expect } from "vitest";
import { buildMediaObjectKey } from "./object-key";

// Media Foundation (Gap C) — object-key layout. Pure and deterministic
// (the unique segment is injected), so the exact key shape is asserted.

describe("buildMediaObjectKey", () => {
  it("builds an owner-scoped, lower-cased key", () => {
    expect(
      buildMediaObjectKey({
        ownerType: "PROVIDER",
        ownerId: "018f2b7c-0000-7000-8000-000000000000",
        kind: "LOGO",
        unique: "abc123",
        ext: "webp",
      })
    ).toBe("provider/018f2b7c-0000-7000-8000-000000000000/logo/abc123.webp");
  });

  it("reflects the owner type and kind in the folder path", () => {
    expect(
      buildMediaObjectKey({ ownerType: "SERVICE", ownerId: "svc-1", kind: "GALLERY", unique: "u", ext: "jpg" })
    ).toBe("service/svc-1/gallery/u.jpg");
  });

  it("keeps different unique segments in distinct keys (no collision on replace)", () => {
    const base = { ownerType: "PROVIDER", ownerId: "p1", kind: "LOGO", ext: "png" } as const;
    const a = buildMediaObjectKey({ ...base, unique: "one" });
    const b = buildMediaObjectKey({ ...base, unique: "two" });
    expect(a).not.toBe(b);
  });
});
