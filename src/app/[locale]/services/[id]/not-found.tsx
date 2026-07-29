import { Link } from "@/i18n/navigation";
import { PackageOpen } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

export default async function ServiceNotFound() {
  const t = await getServerTranslator("services");

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <PackageOpen size={40} strokeWidth={1.5} className="text-foreground/25" />
      <h1 className="text-xl font-semibold text-foreground">{t("notFoundTitle")}</h1>
      <p className="text-sm text-foreground/50">
        {t("notFoundDescription")}
      </p>
      <Link
        href="/services"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("browseAvailableButton")}
      </Link>
    </main>
  );
}
