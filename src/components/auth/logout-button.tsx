"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { t } from "@/lib/i18n/strings";
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

export function LogoutButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "outline-light";
}) {
  const router = useRouter();
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
      {loading ? t.loading : t.logoutButton}
    </Button>
  );
}
