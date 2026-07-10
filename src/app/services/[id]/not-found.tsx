import Link from "next/link";
import { PackageOpen } from "lucide-react";

export default function ServiceNotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <PackageOpen size={40} strokeWidth={1.5} className="text-foreground/25" />
      <h1 className="text-xl font-semibold text-foreground">التجربة غير متوفرة</h1>
      <p className="text-sm text-foreground/50">
        قد تكون هذه التجربة غير منشورة أو تم إزالتها.
      </p>
      <Link
        href="/services"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        تصفح التجارب المتاحة
      </Link>
    </main>
  );
}
