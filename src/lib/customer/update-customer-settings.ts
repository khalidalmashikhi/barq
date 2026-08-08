"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { locales } from "@/i18n/locales";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";

// Customer account settings write (Finish-Line: Customer Profile). Updates the
// self-editable identity fields only — display name (User.name) and preferred
// language (Customer.languagePreference). Deliberately never touches the phone
// number, phoneNumberVerified, status, or any internal id (immutable / security-
// controlled). The Customer row is upserted so a phone-only user who never had
// one can still set a language. Both writes + the audit event run in one
// transaction (BR-019). Empty name clears it back to NULL (falls back to a
// masked phone at display time); an empty language clears the preference.

export type UpdateCustomerSettingsResult = { ok: true } | { ok: false; error: "INVALID_INPUT" | "UNKNOWN_ERROR" };

const MAX_NAME_LENGTH = 120;

export async function updateCustomerSettings(formData: FormData): Promise<UpdateCustomerSettingsResult> {
  const rawName = formData.get("name");
  const rawLanguage = formData.get("languagePreference");

  const name = typeof rawName === "string" ? rawName.trim() : "";
  const language = typeof rawLanguage === "string" ? rawLanguage.trim() : "";

  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  // Language is optional, but when set it must be one of the supported locales.
  if (language && !(locales as readonly string[]).includes(language)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let barqUser;
  try {
    ({ barqUser } = await requireAuth());
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: barqUser.id },
        data: { name: name || null },
      });

      await tx.customer.upsert({
        where: { userId: barqUser.id },
        update: { languagePreference: language || null },
        create: { userId: barqUser.id, languagePreference: language || null },
      });

      await recordAuditEvent(
        {
          actorType: "CUSTOMER",
          actorId: barqUser.id,
          action: "account.settings_updated",
          entityType: "User",
          entityId: barqUser.id,
          newValue: { nameSet: name.length > 0, languagePreference: language || null },
        },
        tx
      );
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("updateCustomerSettings.unexpected_error", {
      userId: barqUser.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
