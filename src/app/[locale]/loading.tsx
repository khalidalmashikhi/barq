// Homepage loading skeleton — Phase 1.5 (Homepage Rendering). Applies
// only to the exact-same-segment page (src/app/[locale]/page.tsx), not
// to nested routes like /about or /services, which already have (or
// don't need) their own loading.tsx. Added because the homepage now
// resolves its section order through a database read
// (getHomepageSectionRenderOrder()) instead of purely static JSX.
// Mirrors services/loading.tsx's plain animate-pulse block convention —
// no new shared component.

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-16 w-full animate-pulse bg-accent/10" />
      <main className="flex-1">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-20">
          <div className="h-10 w-2/3 animate-pulse rounded-lg bg-accent/20" />
          <div className="h-6 w-1/2 animate-pulse rounded-lg bg-accent/10" />
          <div className="h-64 animate-pulse rounded-2xl bg-accent/10" />
        </div>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-2xl bg-accent/10" />
            ))}
          </div>
        </div>
      </main>
      <div className="h-40 w-full animate-pulse bg-accent/5" />
    </div>
  );
}
