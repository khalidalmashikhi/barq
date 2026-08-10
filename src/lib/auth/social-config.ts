import "server-only";

// Google Social Login (Gate 3) — fail-closed provider config + BARQ's explicit,
// safe account-linking policy. Credentials are read from environment variables
// ONLY; the client secret NEVER leaves the server (this module is server-only
// and is never imported into client code).

/**
 * Whether Google sign-in is available on THIS deployment — true only when BOTH
 * credentials are present. Used server-side to decide whether to render the
 * "Continue with Google" / "Connect Google" UI (the boolean is passed to the
 * client as a prop; the credentials themselves never are).
 */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Better Auth `socialProviders.google` config — returned ONLY when both
 * credentials are present (fail-closed); otherwise an empty object so Google is
 * simply not an available provider. Never throws; never logs the secret.
 */
export function buildGoogleSocialProvider(): { google?: { clientId: string; clientSecret: string } } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return {};
  return { google: { clientId, clientSecret } };
}

/**
 * BARQ account-linking policy (Gate-2 identity rules remain authoritative):
 *   • enabled: true            — required so an AUTHENTICATED user can explicitly
 *                                link Google from Settings (linkSocial).
 *   • trustedProviders: []     — NEVER auto-link on a provider's unverified email.
 *   • allowDifferentEmails: false — never link across different email addresses.
 *   • updateUserInfoOnLink: false — never overwrite BARQ profile from Google.
 *
 * Consequence: Better Auth's automatic linking can only fire on a VERIFIED email
 * that exactly matches an existing account. BARQ phone users hold synthetic,
 * unverified `<phone>@phone.barq.internal` emails, so an OTP identity and a
 * Google identity can NEVER be auto-merged — matching email/name is never
 * treated as authority. Cross-method reconnection stays explicit (linkSocial
 * from Settings) or phone-driven (Gate-2 `reconcileVerifiedPhone`).
 */
export const BARQ_ACCOUNT_LINKING = {
  enabled: true,
  trustedProviders: [] as string[],
  allowDifferentEmails: false,
  updateUserInfoOnLink: false,
};
