import { Logo } from "@/components/ui/logo";

// Dashboard footer — lightweight closing element for the dashboard
// page specifically, distinct from components/layout/footer.tsx (the
// marketing-site footer built earlier, still unused pending the
// homepage routing question). No fabricated company details.

export function DashboardFooter() {
  return (
    <footer className="mt-4 flex flex-col items-center gap-4 border-t border-border py-10 text-center">
      <Logo className="h-8 opacity-60" />
      <p className="text-xs text-foreground/40">© {new Date().getFullYear()} برق</p>
    </footer>
  );
}
