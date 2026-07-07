import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";
import { t } from "@/lib/i18n/strings";

// Protected dashboard page — Engineering Sprint 3 (Phone OTP UI).
//
// Deliberately minimal: proves the session-based protection pattern
// works, nothing more. No Customer profile, no Booking, no business
// logic of any kind — all explicitly out of this sprint's scope. A real
// dashboard is a future sprint's task once those domains are implemented.

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">{t.dashboardTitle}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t.dashboardWelcome}</p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
