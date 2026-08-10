import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

const { isGoogleConfigured, buildGoogleSocialProvider, BARQ_ACCOUNT_LINKING } = await import("./social-config");

const ORIGINAL = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
afterEach(() => {
  if (ORIGINAL.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL.id;
  if (ORIGINAL.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL.secret;
});

describe("social-config — Google fail-closed", () => {
  it("is unavailable when neither credential is set", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleConfigured()).toBe(false);
    expect(buildGoogleSocialProvider()).toEqual({});
  });

  it("is unavailable with only a client id (partial config)", () => {
    process.env.GOOGLE_CLIENT_ID = "id-only";
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleConfigured()).toBe(false);
    expect(buildGoogleSocialProvider()).toEqual({});
  });

  it("is unavailable with only a client secret (partial config)", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = "secret-only";
    expect(isGoogleConfigured()).toBe(false);
    expect(buildGoogleSocialProvider()).toEqual({});
  });

  it("is enabled only when BOTH credentials are present", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    expect(isGoogleConfigured()).toBe(true);
    expect(buildGoogleSocialProvider()).toEqual({ google: { clientId: "id", clientSecret: "sec" } });
  });
});

describe("social-config — account-linking security posture (Gate 2 rules preserved)", () => {
  it("never trusts a provider email, never links different emails, never overwrites BARQ profile", () => {
    expect(BARQ_ACCOUNT_LINKING.trustedProviders).toEqual([]);
    expect(BARQ_ACCOUNT_LINKING.allowDifferentEmails).toBe(false);
    expect(BARQ_ACCOUNT_LINKING.updateUserInfoOnLink).toBe(false);
    // Linking itself stays enabled ONLY so authenticated linkSocial works.
    expect(BARQ_ACCOUNT_LINKING.enabled).toBe(true);
  });
});

describe("social-config — no secret reaches the client", () => {
  it("the browser client never references the Google client secret; social-config is server-only", () => {
    const clientSrc = readFileSync("src/lib/auth/client.ts", "utf8");
    expect(clientSrc).not.toContain("GOOGLE_CLIENT_SECRET");
    const socialSrc = readFileSync("src/lib/auth/social-config.ts", "utf8");
    expect(socialSrc).toContain('import "server-only"');
  });
});
