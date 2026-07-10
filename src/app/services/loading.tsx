export default function Loading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-accent/20" />
      <div className="h-32 animate-pulse rounded-2xl bg-accent/10" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-80 animate-pulse rounded-2xl bg-accent/10" />
        ))}
      </div>
    </main>
  );
}
