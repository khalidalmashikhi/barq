export default function Loading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-accent/20" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-6 w-48 animate-pulse rounded-lg bg-accent/20" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-accent/10" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-80 animate-pulse rounded-2xl bg-accent/10" />
        ))}
      </div>
    </main>
  );
}
