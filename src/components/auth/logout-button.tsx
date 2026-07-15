"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

// Logout button — Engineering Sprint 3 (Phone OTP UI), refactored by
// the Visual Identity Sprint to use the shared Button component.
//
// PRESERVED EXACTLY: the signOut() call and redirect-to-"/" behavior —
// only the rendered markup changed, from a raw <button> to <Button
// variant="ghost">.
//
// className is now accepted and passed through (non-conflicting styles
// only — spacing/layout, not variant-owned properties like border/text
// color). For dark backgrounds, use variant="outline-light" instead of
// trying to override "ghost"'s own border/text classes via className,
// which this project's minimal clsx utility cannot safely arbitrate.
//
// INTERNATIONALIZATION PHASE A.1 — CHOSEN AS THE ONE PROOF-OF-WIRING
// COMPONENT: this is the single Client Component migrated from
// strings.ts's flat `t` object to next-intl's useTranslations() in
// this phase, chosen specifically because it is rendered inside
// AppTopBar — present on every authenticated page across both Customer
// and Provider — and uses only 2 keys, both copied verbatim from
// strings.ts's existing ar/en values into messages/{ar,en}/common.json
// (no new copy was authored). No other component was migrated this
// phase; this one exists solely to prove NextIntlClientProvider is
// correctly wired at the real root layout.

export function LogoutButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "outline-light";
}) {
  const router = useRouter();
  const t = useTranslations("common");
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={handleLogout} disabled={loading} className={className}>
      {loading ? t("loading") : t("logoutButton")}
    </Button>
  );
}
