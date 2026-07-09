import { Search, Bell, Globe, MessageCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LogoutButton } from "@/components/auth/logout-button";

// Dashboard top bar — updated per this turn's explicit content list
// (search, notifications, messages, avatar, language, weather, date).
//
// *** WEATHER OMITTED, FLAGGED *** — no longer marked "(optional)" this
// turn, but still no real weather data source exists anywhere in this
// project. Fabricating a temperature reading would be the exact same
// category of dishonesty already avoided for the user's name and
// hero photography — a fake number is not "premium," it's a bug
// waiting to be noticed. Wiring this to a real weather API (e.g.
// OpenWeatherMap) is a small, concrete follow-up — it needs an API key
// as a new env var, the same pattern already established for
// WhatsApp/Maps/LLM Gateway in .env.example — not a design decision.
//
// Date is real — computed client-render-time from the actual current
// date, not fabricated.

export function DashboardTopBar() {
  const today = new Date().toLocaleDateString("ar-OM", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-8 py-4">
      <Logo className="h-8 max-w-[90px]" />

      <div className="hidden max-w-md flex-1 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 mx-8 md:flex">
        <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
        <input
          type="search"
          placeholder="ابحث عن تجربة أو وجهة..."
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          disabled
        />
      </div>

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
