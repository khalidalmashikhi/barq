"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { t } from "@/lib/i18n/strings";

// Logout button — Engineering Sprint 3 (Phone OTP UI).
//
// Unlike the OTP request/verify actions, signOut has never depended on
// the phoneNumber plugin or User-creation questions — it works against
// any existing session regardless of how that session was created.

export function LogoutButton() {
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
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-opacity hover:bg-neutral-50 disabled:opacity-50"
    >
      {loading ? t.loading : t.logoutButton}
    </button>
  );
}
