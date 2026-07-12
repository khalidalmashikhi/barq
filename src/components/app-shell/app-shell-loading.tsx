// AppShellLoading — AppShell Migration (Stabilization).
//
// One shared loading skeleton for any route-level loading.tsx that
// renders inside an AppShell-shaped page (Customer's /dashboard today;
// Provider/Admin/Staff later). Mirrors the exact shape of AppShell
// (top bar + sidebar + main content) so the loading state doesn't
// visually jump when the real content replaces it. Pure Tailwind
// `animate-pulse` blocks, matching the existing convention already
// used by src/app/services/loading.tsx — no new animation library, no
// new design system.
//
// USE THIS ONLY WHEN NO layout.tsx ALREADY RENDERS AppShell ABOVE THE
// route's own loading.tsx (true for Customer's /dashboard, which has
// no layout.tsx). Once a layout.tsx renders <AppShell> around a route
// tree (Provider Dashboard Phase 1b onward), that AppShell already
// resolves and stays mounted while a child page's loading.tsx shows —
// using this full-shell skeleton there would nest a second, fake
// topbar+sidebar inside the real one. Use AppShellContentLoading
// (below) for any route already wrapped by a layout.tsx's AppShell.

export function AppShellLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-8 py-4">
        <div className="h-8 w-20 animate-pulse rounded-lg bg-accent/20" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 animate-pulse rounded-full bg-accent/10" />
          <div className="h-9 w-9 animate-pulse rounded-full bg-accent/10" />
          <div className="h-9 w-9 animate-pulse rounded-full bg-accent/20" />
        </div>
      </div>

      <div className="flex">
        <div className="hidden w-[260px] shrink-0 flex-col gap-3 bg-card px-4 py-8 md:flex">
          <div className="mx-auto h-16 w-16 animate-pulse rounded-xl bg-accent/20" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-accent/10" />
          ))}
        </div>

        <main className="flex-1 p-8">
          <div className="h-32 animate-pulse rounded-2xl bg-accent/10" />
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-accent/10" />
            ))}
          </div>
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl bg-accent/10" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// Content-only counterpart — Provider Dashboard Phase 1b. For any
// route already wrapped by a layout.tsx's <AppShell> (real topbar and
// sidebar already rendered and staying mounted) — this renders only
// the content-area skeleton, not a second fake shell around it.
export function AppShellContentLoading() {
  return (
    <div className="p-8">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-accent/20" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-accent/10" />
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-accent/10" />
        ))}
      </div>
    </div>
  );
}
