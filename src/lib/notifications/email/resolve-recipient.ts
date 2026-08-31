import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isSyntheticAuthEmail } from "@/lib/auth/linked-email";
import { isValidLocale, defaultLocale, type Locale } from "@/i18n/locales";

// BOOKING NOTIFICATION DELIVERY — resolve a notification recipient (a domain User.id) to the email
// address a booking mail may actually be sent to, and the locale to render it in. Reuses the
// CANONICAL verified-email rule (never a second identity algorithm, §8): a genuinely verified,
// non-synthetic AuthUser email, reached via User.authUserId → AuthUser. Also enforces identity
// safety: a DEACTIVATED/SUSPENDED (retired/merged/blocked) user is never emailed.

type Db = PrismaClient | Prisma.TransactionClient;

/// The email is eligible ONLY when the user is active, has a linked AuthUser whose email is
/// verified, non-empty, and not the synthetic @phone.barq.internal placeholder. Returns null in
/// every other case (no row, inactive/merged identity, no auth link, unverified/synthetic email) —
/// the caller marks such a delivery SKIPPED (terminal), never guessing an address.
export async function resolveRecipientVerifiedEmail(db: Db, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true, authUser: { select: { email: true, emailVerified: true } } },
  });
  if (!user) return null;
  // Identity safety: never email a retired/merged (DEACTIVATED) or blocked (SUSPENDED) account.
  if (user.status === "DEACTIVATED" || user.status === "SUSPENDED") return null;

  const email = user.authUser?.email ?? null;
  const verified = user.authUser?.emailVerified === true;
  if (!verified || email === null || email.trim() === "" || isSyntheticAuthEmail(email)) return null;
  return email;
}

/// The recipient's locale for rendering. Customers carry a stored languagePreference; providers (and
/// anyone without a valid stored preference) fall back to the platform default (Arabic). No provider
/// locale field is created in this gate — documented limitation.
export async function resolveRecipientLocale(db: Db, userId: string): Promise<Locale> {
  const customer = await db.customer.findUnique({
    where: { userId },
    select: { languagePreference: true },
  });
  const pref = customer?.languagePreference;
  return pref && isValidLocale(pref) ? pref : defaultLocale;
}
