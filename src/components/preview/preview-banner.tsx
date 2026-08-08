import { Eye } from "lucide-react";

// PreviewBanner — Unified Preview System. A single, unmistakable banner shown
// at the top of every provider/admin preview so the viewer always knows this
// is a non-public preview. Deliberately presentation-only and i18n-agnostic:
// the caller passes an already-translated title/description (each preview
// route resolves it from whichever namespace it already loads), so this stays
// one reusable component with no namespace coupling. Logical properties
// (start/gap) keep it correct in both RTL and LTR.

type PreviewBannerProps = {
  title: string;
  description?: string;
};

export function PreviewBanner({ title, description }: PreviewBannerProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-amber-900 dark:text-amber-200"
    >
      <Eye size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <div className="flex flex-col">
        <span className="text-sm font-semibold">{title}</span>
        {description && <span className="text-xs opacity-80">{description}</span>}
      </div>
    </div>
  );
}
