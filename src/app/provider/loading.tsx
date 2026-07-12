import { AppShellContentLoading } from "@/components/app-shell/app-shell-loading";

// Fixed (Phase 1b): now nested inside src/app/provider/layout.tsx's
// own <AppShell> — uses the content-only skeleton, not the full-shell
// one, to avoid rendering a second fake topbar+sidebar inside the real
// one now that a layout.tsx exists for this route tree.

export default function Loading() {
  return <AppShellContentLoading />;
}
