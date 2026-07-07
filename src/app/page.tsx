import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { t } from "@/lib/i18n/strings";

// Landing/login page — Engineering Sprint 3 (Phone OTP UI).
//
// Server Component: checks session server-side and redirects an already
// authenticated user to /dashboard before rendering the login form at
// all — never flashes the form to a signed-in user first.
//
// This redirect works today, independent of the OTP schema blocker,
// since it only depends on session *existence* (Sprint 2's getSession
// helper), not on which sign-in method populated it.

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-neutral-900">{t.appName}</h2>
      </div>
      <LoginForm />
    </main>
  );
}
