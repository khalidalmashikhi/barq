import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Customer account settings read (Finish-Line: Customer Profile). Returns the
// legitimately self-editable identity fields for the signed-in user: a display
// name (User.name — the identity record owns it, reused by every role) and a
// preferred language (Customer.languagePreference). The phone number is
// returned for read-only display (it is the immutable auth identity, shown to
// the owner in full — it is their own number). Gated by requireAuth: these are
// universal account settings, not role-scoped, and a Customer row is created
// lazily on save when absent.

export type CustomerSettings = {
  name: string;
  phoneNumber: string | null;
  languagePreference: string;
};

export async function getCustomerSettings(): Promise<CustomerSettings> {
  const { barqUser } = await requireAuth();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
    select: { languagePreference: true },
  });

  return {
    name: barqUser.name ?? "",
    phoneNumber: barqUser.phoneNumber,
    languagePreference: customer?.languagePreference ?? "",
  };
}
