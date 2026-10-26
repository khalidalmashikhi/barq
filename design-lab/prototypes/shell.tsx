import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Bell, Compass, Home, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { clsx } from "@/components/ui/clsx";
import { FOCUS_RING } from "../tokens";

// Prototype shells (Storybook only).
//   TaskShell   — task screens (vehicle journey): back + task title + language; NO bottom nav and no
//                 footer; the sticky action bar is the only bottom element. From 1024 px the bar
//                 moves into a side panel (`aside`).
//   BrowseShell — browse screens (trip plan): logo + language; the 5-tab bottom nav on phones only.

function LanguageLink() {
  const other = useLocale() === "en" ? "العربية" : "English";
  return (
    <a href="#language" className={`inline-flex min-h-11 items-center rounded-xl px-3 text-[1rem] font-medium text-foreground/70 hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
      {other}
    </a>
  );
}

export function TaskShell({ title, backLabel, children, bar, aside }: { title: ReactNode; backLabel: string; children: ReactNode; bar?: ReactNode; aside?: ReactNode }) {
  const rtl = useLocale() !== "en";
  const Back = rtl ? ArrowRight : ArrowLeft;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-foreground/10 bg-background/95 px-2 backdrop-blur lg:px-8">
        <a href="#back" aria-label={backLabel} className={`flex size-11 items-center justify-center rounded-xl text-primary hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
          <Back size={22} aria-hidden />
        </a>
        <span className="min-w-0 flex-1 text-[1.0625rem] font-semibold">{title}</span>
        <LanguageLink />
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col lg:flex-row lg:items-start lg:gap-6 lg:px-8 lg:py-8">
        <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-6 pt-5 lg:px-0 lg:pt-0">{children}</main>
        {aside && <aside className="hidden w-[21rem] shrink-0 lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-3">{aside}</aside>}
      </div>
      {/* `contents`: the wrapper is not a box, so the bar stays sticky against the page scroll. */}
      {bar && <div className={clsx("contents", aside ? "lg:hidden" : undefined)}>{bar}</div>}
    </div>
  );
}

export function BrowseShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  // The same keys as the app's bottom nav (customer-bottom-nav.tsx).
  const t = useTranslations("landing");
  const tabs = [
    { icon: Home, label: t("nav.home") },
    { icon: Compass, label: t("nav.explore"), active: true },
    { icon: CalendarDays, label: t("nav.bookings") },
    { icon: Bell, label: t("nav.notifications") },
    { icon: UserRound, label: t("nav.account") },
  ];
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-foreground/10 bg-background/95 px-4 backdrop-blur lg:px-8">
        <span className="min-w-0 flex-1 text-[1.0625rem] font-semibold">{title}</span>
        <LanguageLink />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pb-6 pt-5 lg:pt-8">{children}</main>
      <nav aria-label={t("nav.marketplaceNavLabel")} className="sticky bottom-0 z-20 flex border-t border-foreground/10 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {tabs.map(({ icon: Icon, label: l, active }) => (
          // min-w-0 + a pill that shrinks + a truncating label: five tabs fit 375 px at 200 % text.
          <a key={l} href={`#${l}`} aria-current={active ? "page" : undefined} className={clsx("flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.8125rem]", active ? "font-bold text-primary" : "font-medium text-foreground/70", FOCUS_RING)}>
            <span className={clsx("flex h-8 w-full max-w-14 items-center justify-center rounded-full", active && "bg-[#EEF4F8]")}>
              <Icon size={22} aria-hidden />
            </span>
            <span className="block max-w-full truncate">{l}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
