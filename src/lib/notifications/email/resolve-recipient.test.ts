import { describe, it, expect, vi } from "vitest";
import { resolveRecipientVerifiedEmail, resolveRecipientLocale } from "./resolve-recipient";

// BOOKING NOTIFICATION DELIVERY — the canonical verified-email + locale resolution. Proves the
// eligibility rule (verified, non-empty, non-synthetic, active identity) and the locale fallback.

vi.mock("server-only", () => ({}));

function db(user: unknown, customer?: unknown) {
  return {
    user: { findUnique: vi.fn(async () => user) },
    customer: { findUnique: vi.fn(async () => customer ?? null) },
  } as never;
}

describe("resolveRecipientVerifiedEmail", () => {
  it("returns the email for a verified, non-synthetic, active user", async () => {
    const email = await resolveRecipientVerifiedEmail(
      db({ status: "ACTIVE", authUser: { email: "real@example.com", emailVerified: true } }),
      "u1",
    );
    expect(email).toBe("real@example.com");
  });

  it("null when the email is not verified", async () => {
    expect(
      await resolveRecipientVerifiedEmail(db({ status: "ACTIVE", authUser: { email: "x@example.com", emailVerified: false } }), "u1"),
    ).toBeNull();
  });

  it("null for a synthetic phone placeholder email", async () => {
    expect(
      await resolveRecipientVerifiedEmail(
        db({ status: "ACTIVE", authUser: { email: "96890000000@phone.barq.internal", emailVerified: true } }),
        "u1",
      ),
    ).toBeNull();
  });

  it("null when there is no linked AuthUser or no email", async () => {
    expect(await resolveRecipientVerifiedEmail(db({ status: "ACTIVE", authUser: null }), "u1")).toBeNull();
    expect(await resolveRecipientVerifiedEmail(db({ status: "ACTIVE", authUser: { email: "", emailVerified: true } }), "u1")).toBeNull();
  });

  it("null for a DEACTIVATED (retired/merged) or SUSPENDED identity, even with a verified email", async () => {
    for (const status of ["DEACTIVATED", "SUSPENDED"]) {
      expect(
        await resolveRecipientVerifiedEmail(db({ status, authUser: { email: "real@example.com", emailVerified: true } }), "u1"),
      ).toBeNull();
    }
  });

  it("null when the user does not exist", async () => {
    expect(await resolveRecipientVerifiedEmail(db(null), "u1")).toBeNull();
  });
});

describe("resolveRecipientLocale", () => {
  it("uses a valid stored customer language preference", async () => {
    expect(await resolveRecipientLocale(db(null, { languagePreference: "fr" }), "u1")).toBe("fr");
  });

  it("falls back to the default locale (ar) for an invalid/absent preference or a provider (no customer row)", async () => {
    expect(await resolveRecipientLocale(db(null, { languagePreference: "xx" }), "u1")).toBe("ar");
    expect(await resolveRecipientLocale(db(null, { languagePreference: null }), "u1")).toBe("ar");
    expect(await resolveRecipientLocale(db(null, null), "u1")).toBe("ar");
  });
});
