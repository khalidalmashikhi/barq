export default function Loading() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <div className="h-72 animate-pulse rounded-2xl bg-accent/10 sm:h-96" />
      <div className="h-8 w-64 animate-pulse rounded-lg bg-accent/20" />
      <div className="h-24 animate-pulse rounded-2xl bg-accent/10" />
    </main>
  );
}
