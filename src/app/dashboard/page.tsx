import { redirect } from "next/navigation";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";
import { t } from "@/lib/i18n/strings";

// Protected dashboard page — Engineering Sprint 3 (Phone OTP UI),
// upgraded by the RBAC sprint to use requireAuth() (resolving the BARQ
// User, per DOMAIN_MODEL.md/ADR-0009) instead of bare Better Auth
// session-existence checking.
//
// SCOPE NOTE: only one dashboard page/route exists. "Protect according
// to role" is applied conservatively here — this page requires *some*
// authenticated BARQ identity (via requireAuth()), and this is the
// natural place a real dashboard would later branch on role (Customer
// vs. Provider vs. Staff vs. Admin views). Inventing separate
// role-specific dashboard pages/routes now would be scope creep beyond
// "RBAC helpers" into actual dashboard feature UI, which remains
// explicitly out of scope (no Customer profile, no Booking, no
// Provider features, per this sprint's instructions).

export default async function DashboardPage() {
  let barqUserId: string;

  try {
    const { barqUser } = await requireAuth();
    barqUserId = barqUser.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    throw error;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">{t.dashboardTitle}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t.dashboardWelcome}</p>
        <p className="mt-1 text-xs text-neutral-400">{barqUserId}</p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
