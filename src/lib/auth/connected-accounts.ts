import "server-only";
import { headers } from "next/headers";
import { auth } from "./server";

// Social Login (Gate 3) — safe, server-side introspection of which auth
// providers the CURRENT session's account has linked, for the Settings
// "Sign-in methods" section. Uses Better Auth's supported server API
// (listUserAccounts) — NEVER a raw client-side Prisma Account query — and
// returns ONLY provider ids (no accessToken/refreshToken/idToken/secret/OAuth
// metadata ever reaches the caller or the client).
export async function getLinkedProviderIds(): Promise<string[]> {
  const accounts = await auth.api.listUserAccounts({ headers: await headers() });
  return accounts.map((account) => account.providerId);
}
