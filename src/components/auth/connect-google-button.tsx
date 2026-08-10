"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/lib/auth/client";
import { GoogleIcon } from "@/components/ui/google-icon";

// Social Login (Gate 3) — the authenticated "Connect Google" action for the
// Settings page. Uses Better Auth's linkSocial(), which attaches the Google
// Account to the CURRENT AuthUser (same BARQ User / Customer / Provider / Admin
// preserved — never a new/claimed identity). callbackURL is a FIXED internal,
// locale-prefixed path (never user input) — no open-redirect surface.
export function ConnectGoogleButton() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const { error: linkError } = await authClient.linkSocial({
        provider: "google",
        callbackURL: `/${locale}/dashboard/settings`,
      });
      if (linkError) {
        setError(t("connectGoogleError"));
        setLoading(false);
      }
      // On success the browser is redirected to Google; nothing after runs.
    } catch {
      setError(t("connectGoogleError"));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleConnect}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
      >
        <GoogleIcon size={16} />
        {loading ? t("connectGoogleLoading") : t("connectGoogleButton")}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
