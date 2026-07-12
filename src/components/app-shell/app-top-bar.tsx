import type { ReactNode } from "react";
import { Bell, Globe, MessageCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LogoutButton } from "@/components/auth/logout-button";

// AppTopBar — AppShell Migration (Stabilization).
//
// Generalized from the former, Customer-only src/components/dashboard/
// top-bar.tsx. The structural chrome (logo, date, language/messages/
// notifications icons — all decorative/non-functional today, unchanged
// from before), and LogoutButton are role-agnostic and stay built in.
// The one genuinely Customer-specific piece — the "search for an
// experience" box — is NOT hardcoded here; it is passed in via the
// optional `centerContent` slot, so a future Provider/Admin top bar can
// supply its own center content (or none) without a separate
// ProviderTopBar component existing at all.
//
// No "use client" needed — identical to the original component, this
// has no client-only hooks of its own (Date computation runs fine
// server-side); LogoutButton is a Client Component embedded as a
// normal child, the standard, always-supported Server-renders-Client
// pattern.

type AppTopBarProps = {
  centerContent?: ReactNode;
};

export function AppTopBar({ centerContent }: AppTopBarProps) {
  const today = new Date().toLocaleDateString("ar-OM", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-8 py-4">
      <Logo className="h-8 max-w-[90px]" />

      {centerContent}

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-foreground/40 lg:inline">{today}</span>

        <button
          type="button"
          className="rounded-full p-2 text-foreground/60 transition-colors hover:bg-accent/20 hover:text-foreground"
          aria-label="اللغة"
        >
          <Globe size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="rounded-full p-2 text-foreground/60 transition-colors hover:bg-accent/20 hover:text-foreground"
          aria-label="الرسائل"
        >
          <MessageCircle size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="relative rounded-full p-2 text-foreground/60 transition-colors hover:bg-accent/20 hover:text-foreground"
          aria-label="الإشعارات"
        >
          <Bell size={18} strokeWidth={1.75} />
          <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-secondary" />
        <LogoutButton variant="ghost" />
      </div>
    </div>
  );
}
